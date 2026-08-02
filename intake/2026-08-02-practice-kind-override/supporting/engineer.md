# Engineering assessment: per-practice `kind`/`defaultSeverity` override

Scope: implement an operator-set override of a Playbook practice's `kind`
(and optionally `defaultSeverity`), resolved at Observation fire-time, per
the request brief at `intake/2026-08-02-practice-kind-override/request-brief.md`.

All file/line references below were read directly from the repo at
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor` on 2026-08-02.

## 1. Exact change set

The brief leaves one real fork in the road (schema shape — generic `config`
JSON vs. a dedicated column) and everything downstream depends on that
choice. I recommend the **generic-config route** (Option A below) — it is
materially smaller, and nothing in the request requires a dedicated column.
I list both so the size difference is visible, but Option A is what I'd
build.

### Option A (recommended): reuse the existing `config` JSON blob, no `CREATE TABLE`/`ALTER TABLE` change

`playbook_practice_config.config` is already an untyped `TEXT` JSON blob
(`server/db.js` line 1351: `config TEXT NOT NULL DEFAULT '{}'`). Storing
`{ thresholdTokens: 100000000, kindOverride: "risk" }` in that same column
needs zero DDL. This sidesteps §9.5 entirely (no new column, so no
`PRAGMA table_info` guard, no `UPGRADE_CASES` entry — the fresh-DB-blind
trap literally can't apply because there's no schema to be blind about).

Files/functions:

1. **`server/lib/playbook/practices.js`**
   - `resolvePracticeConfig(row, practice)` (lines 101-117): today it only
     loops `practice.fields` and copies `typeof value === "number"` stored
     values over the numeric defaults. It has **no path at all** for a
     non-numeric key like `kindOverride`/`severityOverride` — those keys
     would currently just sit unused in `stored` and be silently dropped
     from the returned `config` object. Needs a second, explicit block
     (not a generalization of the numeric-field loop, since `kind` isn't a
     `fields[]` entry) that reads `stored.kindOverride`/`stored.severityOverride`,
     validates against the allowed enum (`risk`/`info`/`good` for kind — no
     enum constraint exists for severity, which is a plain `string` today,
     see gotcha 5 below), and returns them alongside `enabled`/`config`,
     e.g. a new `{ enabled, config, kind, severity }` return shape (or a
     nested `overrides` object — either way this function's return contract
     changes, so every caller must be checked, see below).
   - `defaultConfigFor(practice)` (lines 85-89) is unaffected — it only
     seeds numeric `fields[]` defaults.
   - `PRACTICES` catalog entries themselves are unaffected — `kind`/
     `defaultSeverity` stay exactly as-is; the override is a resolve-time
     overlay, not a catalog schema change.

2. **`server/lib/playbook/engine.js`** — the two exact fire-time call
   sites that must switch off the bare catalog values:
   - `evaluateSession()` line 93-100: `insertCoachObservation.run(practice.id, "session", sessionId, practice.kind, practice.defaultSeverity, ...)` → must become the *resolved* kind/severity, i.e. whatever `resolvePracticeConfig`/`resolveEnabledPractices` now attaches (e.g. `resolvedKind`/`resolvedSeverity` destructured from the per-practice object built in `resolveEnabledPractices`, line 34-42).
   - `evaluateGlobal()` line 141-147: identical pair of hardcoded
     `practice.kind, practice.defaultSeverity` args, same fix.
   - `resolveEnabledPractices(dbModule)` (lines 35-42) is the natural place
     to compute and attach the resolved kind/severity once per tick (it
     already spreads `resolvePracticeConfig(...)` into each entry), so
     `evaluateSession`/`evaluateGlobal` just read `p.kind`/`p.severity`
     off the object already being destructured (`const { practice, config }`
     → `const { practice, config, kind, severity }`) instead of reaching
     into `practice.kind` directly. **This is the one call-site change the
     brief explicitly calls "the exact site that must read the override
     instead."**

3. **`server/routes/playbook.js`**
   - `serializePractice(practice)` (lines 33-46): currently hardcodes
     `kind: practice.kind, defaultSeverity: practice.defaultSeverity` (the
     bare catalog values) into every `GET /api/playbook/practices` /
     `PUT .../config` response. Needs to additionally surface the
     *resolved* value (what the UI should show as "current") and,
     separately, whatever raw override is stored (so the UI can
     distinguish "using default" from "explicitly overridden to X" — a
     distinction the current numeric fields don't need since they render a
     single number regardless of source, but a selector plausibly wants to
     show "(default)" vs. an explicit choice). Minimum viable shape: keep
     `kind`/`defaultSeverity` meaning "catalog built-in" (existing
     contract, existing consumers unaffected) and add two new response
     fields, e.g. `resolvedKind`/`resolvedSeverity` (or `kindOverride:
     string | null`). **Whichever shape is picked must match exactly what
     `client/src/lib/types.ts`'s `PlaybookPractice` interface and
     `server/openapi-extra/playbook-coach.js`'s `PlaybookPractice` schema
     both declare — this is the project's own "same field, same value,
     across every consumer" bar (PROJECT-CONTEXT.md §9.1), applied to a
     brand-new field this time, not a preexisting derived one.**
   - `validateConfigPatch(practice, patch)` (lines 52-70): today rejects
     *any* patch key not present in `practice.fields` (line 59-61:
     `if (!field) throw new ValidationError("unknown config field...")`).
     A `kindOverride`/`severityOverride` key sent in `body.config` would be
     **rejected outright by this exact guard** unless it's special-cased
     before/around the `fields` loop. This is the single most important
     "gotcha" in the whole change (see §5.1).
   - `router.put("/practices/:id/config", ...)` (lines 78-107): needs the
     validation branch above, then persists via the same
     `stmts.upsertPlaybookPracticeConfig.run(...)` (no DB-layer change
     needed under Option A — it already stores the whole config object as
     JSON verbatim).

4. **`server/openapi-extra/playbook-coach.js`**
   - `schemas.PlaybookPractice` (lines 70-122): add the new response
     field(s) (`resolvedKind`/`resolvedSeverity` or equivalent), update the
     `required` array if they're always-present, and update the two
     hand-written `example` blocks under `/api/playbook/practices` (lines
     272-309) and `/api/playbook/practices/{id}/config` (lines 349-361) —
     both are literal JSON examples, not generated, so they silently drift
     out of sync with the real response unless hand-edited too.
   - `schemas.PlaybookConfigPatchRequest` (lines 136-154): document that
     `config` may now also carry `kindOverride`/`severityOverride` keys,
     not just numeric field keys — the current description text explicitly
     says "Every key must match one of the practice's own `fields[].key`"
     (line 149), which becomes **false** the moment this ships; that line
     itself must change or the OpenAPI doc actively lies about the new
     capability.
   - `schemas.CoachObservation.properties.kind`/`.severity` descriptions
     (lines 192-201, "Copied from the practice's own `kind`/`defaultSeverity`
     at detection time") should be tightened to say "the *resolved*
     kind/severity (catalog default or override, whichever applied) at
     detection time" — still frozen-at-insert, just clarifying which value
     gets frozen.

5. **`client/src/lib/types.ts`**
   - `PlaybookPractice` interface (lines 2383-2393): add the matching new
     field(s) (`resolvedKind: "risk" | "info" | "good"`, `resolvedSeverity:
     string`, or an `override: { kind?, severity? } | null`) — must mirror
     whatever shape step 3 picked exactly, or the client silently reads
     `undefined`.

6. **`client/src/lib/api.ts`**
   - `playbook.updatePracticeConfig(id, patch)` (lines 2168-2175): the
     `patch: { enabled?: boolean; config?: Record<string, number> }` type
     signature is `Record<string, number>` — a string-valued
     `kindOverride: "risk"` **does not typecheck** against this today. Needs
     widening to `Record<string, number | string>` or a separate typed
     field, whichever the server contract picked.

7. **`client/src/lib/playbookStore.ts`**
   - `save(id, patch)` (lines 117-133): the in-memory optimistic-merge
     type signature (`patch: { enabled?: boolean; config?: Record<string,
     number> }`) has the same `number`-only narrowing as `api.ts` and needs
     the same widening.
   - `isValidPractice()` (lines 19-22) is a light structural check
     (`id`/`enabled`/`config` present) — likely unaffected, but worth a
     glance once the new field(s) land, in case validity should require
     them too.

8. **`client/src/pages/PlaybookPage.tsx`** — genuinely new UI, not a
   drop-in:
   - `PRACTICE_CARDS` (lines 359-362) maps `session-token-ceiling` →
     `SessionTokenCeilingCard`, `account-weekly-balance` →
     `AccountWeeklyBalanceCard`; **neither card currently renders anything
     about `kind`** except passing the bare catalog `practice.kind` straight
     into the live preview's `<ObservationCard kind={practice.kind} .../>`
     (line 257 in `SessionTokenCeilingCard`, line 335 in
     `AccountWeeklyBalanceCard`). Both of these **must** change to the
     *resolved* kind (override ?? catalog default), or the live preview
     will keep showing the pre-override label forever even after a kind
     override is saved — a direct, easy-to-miss regression, since nothing
     else currently touches `kind` in this file.
   - Need a new shared control, e.g. `KindOverrideSelect` (a 3-option
     `<select>` or radio group over `risk`/`info`/`good`, with a
     "(default: X)" affordance), analogous to `PracticeCardActions` (lines
     102-141) as shared chrome — since the brief itself notes there's "no
     generic/shared kind selector control today." This needs to be wired
     into `PracticeCardShell` or added per-card next to each existing
     numeric field, plus its own dirty/save-pulse state threaded the same
     way `enabled`/`draft` already are per card.
   - Both cards' `isDirty`/`onSave`/`onReset` logic (lines 180, 267-268 and
     284, 351-352) need the new override value folded into the dirty-check
     and the `playbookStore.save(...)` payload.

9. **`client/src/i18n/locales/{en,vi,zh,ko}/coach.json`**
   - `kindLabel` (`risk`/`info`/`good` → Warning/Reminder/Reinforcement,
     confirmed present and structurally identical across all four locale
     files — verified directly, not just assumed) is directly reusable as
     the selector's option labels via `t(\`kindLabel.${value}\`)`, the same
     lookup `ObservationCard.tsx` line 110 already does. **No new i18n
     keys needed for the kind selector itself.** If `defaultSeverity`
     override also ships, note `severity` has **no i18n label mapping
     anywhere** today (`ObservationCard.tsx` never renders `severity` at
     all — confirmed by reading the whole file; only `kind` drives the
     badge/border color, lines 85-96, 109-110). A severity selector would
     need brand-new label strings in all four locale files, since there's
     nothing to reuse.

### Option B: dedicated columns (`kind_override`, `severity_override`) on `playbook_practice_config`

Only if the team decides the generic-JSON approach is architecturally
undesirable. Adds, on top of everything in Option A except the
`resolvePracticeConfig`/`validateConfigPatch` JSON-key handling (which
becomes direct column reads instead):

- `server/db.js`: a guarded migration block modeled exactly on the existing
  `color_thresholds` session/weekly-split precedent (lines 1300-1319) —
  `const cols = db.prepare("PRAGMA table_info(playbook_practice_config)").all();` then conditional `ALTER TABLE playbook_practice_config ADD COLUMN kind_override TEXT` / `... ADD COLUMN severity_override TEXT` guarded on `!cols.some(c => c.name === "kind_override")` etc. Must NOT be a bare `CREATE TABLE IF NOT EXISTS` change (that no-ops on every existing DB — exactly PROJECT-CONTEXT.md §9.5's named failure mode).
- `server/__tests__/db-migration.test.js`: a new `UPGRADE_CASES` entry (see
  the `color_thresholds` entry pattern around line 549) seeding the
  *pre-migration* table shape (no `kind_override`/`severity_override`
  columns) and asserting the `ALTER TABLE` runs cleanly and old rows get a
  sane default (`NULL`, meaning "no override"). The meta-test at line 714
  (`describe("Migration meta-test"...)`) will **fail CI automatically** if
  this new column ships without a matching `UPGRADE_CASES` entry — this is
  a real, already-wired tripwire, not a hoped-for one.
- `stmts.upsertPlaybookPracticeConfig` (`server/db.js` lines 1854-1861)
  needs two more bound params and two more `ON CONFLICT ... DO UPDATE SET`
  clauses.

Option B is strictly more work for no behavioral difference the brief asks
for — I'd only take it if there's a reason (not stated anywhere in the
brief) to want `kind`/`severity` overrides queryable/indexable independent
of the JSON blob.

## 2. Feasibility

Mechanically simple at the engine layer — genuinely one call site per
scope (`evaluateSession`, `evaluateGlobal`), both already reading
`practice.kind`/`practice.defaultSeverity` from the same catalog object, both
already fed by the same `resolveEnabledPractices()` merge point. There is
no branching by scope/mode/tier that multiplies the engine work — `session`
and `global` scope evaluation are the only two variants that exist
(`project` scope is unbuilt, per engine.js's own header comment line 12),
and both need the identical one-line change.

The complexity is concentrated in three places that are easy to
underestimate from reading only the two files the brief names first:

- `resolvePracticeConfig`'s validation loop is numeric-only by construction
  (`typeof value === "number"`, `value >= field.min`) — it is not a generic
  "merge stored config over defaults" function that happens to only see
  numbers today; it actively *requires* numeric fields with a `min`. A
  string enum override cannot flow through this loop unmodified; it needs
  parallel, separate handling, which is the brief's own suspicion,
  confirmed correct.
- The **same** numeric-only assumption is independently baked into
  `validateConfigPatch` in `routes/playbook.js` (line 63: `typeof value
  !== "number"` throws). Both call sites make the same assumption for the
  same underlying reason (both walk `practice.fields`), so a fix to one
  without the other leaves either the server accepting garbage or
  rejecting legitimate overrides.
- The UI has no shared selector control and both existing cards hardcode
  `kind={practice.kind}` into their live preview — that's new code, not a
  config change, and it's the one place a "just wire the value through"
  mental model breaks down.

No hidden per-practice branching: there are exactly two practices in the
catalog today (`session-token-ceiling`, `account-weekly-balance`), and
whatever mechanism is built must generalize to both automatically (via the
shared `resolvePracticeConfig`/engine path) rather than needing a
per-practice special case — consistent with the catalog's stated design
ethos ("a new practice is a new catalog entry, not new plumbing," per
`practices.js`'s own file-header comment, lines 9-12).

## 3. Effort estimate

**M** (medium) for Option A end-to-end (server + client + i18n check +
tests). Breakdown:

- Server (`practices.js` resolve logic, `engine.js` two call sites,
  `routes/playbook.js` validation + serialization, OpenAPI schema/examples):
  **S–M**. Small in line count, but touches four files that all encode the
  same "numeric fields only" assumption and must change in lockstep.
- Client (`types.ts`, `api.ts`, `playbookStore.ts` type widening +
  `PlaybookPage.tsx` new selector UI + preview-kind fix in both cards):
  **M**. The new selector control is genuinely new UI (no existing
  component to extend), and it must land in two separate card components
  since there's no shared field-rendering abstraction between them today.
- i18n: **XS** — kind labels already exist and are confirmed consistent
  across all four locales; only needed if `defaultSeverity` override also
  ships (then it's new-strings-in-four-files, still small).
- Tests: **S–M** — the engine test file already has a working pattern for
  "seed a stored config override, assert engine behavior changes" (e.g.
  `playbook.test.js` lines 142-153, 204-215); extending it to kind/severity
  is mechanical repetition of that exact pattern, plus one new explicit
  "changing the override after the fact does not touch existing rows" test
  the brief calls out as the acceptance signal (not present in any form
  today — every existing test only ever checks *newly created* rows).

Option B adds a firm **+S** on top for the migration/`UPGRADE_CASES`
obligation, with no offsetting benefit visible in the brief's stated scope.

## 4. Dependencies & order

1. **Decide + land the schema shape first** (Option A vs B) — everything
   else depends on knowing whether `resolvePracticeConfig` reads from the
   existing `config` JSON or from new dedicated columns. This is the
   "shared registry/mapping entry before downstream code" gate the brief
   is implicitly asking about: `resolvePracticeConfig`/`defaultConfigFor`
   in `practices.js` is that shared resolution point for *every* downstream
   consumer (engine, route, and — via the route's response shape — the
   client), so it must land and be correct before `engine.js`'s call sites
   or `routes/playbook.js`'s serialization can be written against a stable
   contract.
2. **`server/lib/playbook/practices.js`** — `resolvePracticeConfig`'s new
   return shape (kind/severity alongside enabled/config).
3. **`server/lib/playbook/engine.js`** — the two `insertCoachObservation.run`
   call sites, reading the new resolved values instead of bare
   `practice.kind`/`practice.defaultSeverity`.
4. **`server/routes/playbook.js`** — `validateConfigPatch` (accept the new
   override key(s)) and `serializePractice` (expose the resolved value) —
   these can be done in parallel with each other but both depend on step 2's
   shape being final.
5. **`server/openapi-extra/playbook-coach.js`** — update schemas/examples
   to match the now-final API shape from step 4 (should be done in the same
   PR/commit as step 4, not after, so the doc never ships stale even
   briefly).
6. **`client/src/lib/types.ts` + `api.ts` + `playbookStore.ts`** — type
   updates, depend on step 4's finalized response/patch shape.
7. **`client/src/pages/PlaybookPage.tsx`** — new selector UI + preview-kind
   fix, depends on step 6.
8. **Tests** (`server/__tests__/playbook.test.js`, and
   `db-migration.test.js` if Option B) can and should be written alongside
   steps 2-4 (server) and 7 (client), not purely after — the existing file
   already interleaves engine tests and route tests in one file, so new
   cases slot into the existing `describe` blocks rather than needing a new
   file.

No cross-cutting infra changes (no new service, no new WS message type —
`playbook_practice_config_updated` already broadcasts the full merged
practice object, so it carries the new field for free once `serializePractice`
includes it).

## 5. Gotchas

### 5.1 The numeric-only validation gate is duplicated, not shared — and both copies must change together

`resolvePracticeConfig` (`practices.js` lines 110-115) and
`validateConfigPatch` (`routes/playbook.js` lines 56-69) independently
encode "only known `fields[].key` names, only finite numbers ≥ `min`."
Adding a `kindOverride` string key without updating **both** produces one
of two silent failure modes depending on which one is missed:
- Miss `validateConfigPatch` only: the PUT request throws
  `INVALID_CONFIG: unknown config field "kindOverride"` — the feature
  appears entirely broken from the UI (400 on every save attempt).
- Miss `resolvePracticeConfig` only: the PUT succeeds and persists the raw
  JSON (since `upsertPlaybookPracticeConfig` stores whatever's handed to
  it), but every *read* path (`GET /api/playbook/practices`, the engine's
  `resolveEnabledPractices`) silently ignores the stored override forever
  — the classic "saved but never applied" bug, and the kind of thing that
  passes a shallow "does the PUT 200?" smoke test while failing the actual
  acceptance criterion.

This is the single highest-value place to double-check the diff before
calling this done.

### 5.2 §9.1-shaped trap, but the brief already flags it in the *inverse* direction — don't over-correct

The brief is explicit that `coach_observations.kind` (frozen at insert) and
the *live* resolved kind (catalog + current override) are **supposed** to
diverge after an override change — this is by design, not a bug. The
practical risk here is a well-intentioned "fix" that adds a trigger, a
computed column, or a periodic backfill to keep old Observations' `kind`
"in sync" with the practice's current override — that would be actively
wrong for this feature. Any code review flagging "these two `kind` values
don't match" on this feature should be met with the acceptance criterion
in the brief (§ "Explicit acceptance signals"), not treated as a defect.

### 5.3 Preview UI silently shows the wrong kind unless both cards are touched

`PlaybookPage.tsx` lines 257 and 335 pass `practice.kind` (the bare catalog
value) directly into the live preview's `ObservationCard`. If the new
selector is added but these two lines aren't updated to the *resolved*
kind, the config UI will let an operator pick "Warning" for
`account-weekly-balance`, save successfully, and then show a preview card
still labeled "Reminder" underneath the very control that just changed it
— a visibly broken feature that a route-level or engine-level test would
never catch (it's purely a client wiring miss).

### 5.4 API/type contracts must move together, not just server-then-client

The `patch: { enabled?: boolean; config?: Record<string, number> }` type is
declared **twice** on the client (`api.ts` line 2170,
`playbookStore.ts` line 119) and once implicitly via the OpenAPI
`PlaybookConfigPatchRequest.config.additionalProperties: { type: "number"
}` (`playbook-coach.js` line 150). All three currently say "numbers only."
A string-valued override breaks TypeScript compilation at both client call
sites if only one is widened, and the OpenAPI schema becomes actively
false (not just incomplete) if left as `additionalProperties: number` while
the real API now accepts strings too.

### 5.5 `defaultSeverity` has no enum and no UI rendering today

Unlike `kind` (`CHECK(kind IN ('risk','info','good'))` at the DB layer,
`server/db.js` line 1372, and a matching TS union type), `severity` is a
plain unconstrained string everywhere (`defaultSeverity: "warning"` /
`"info"` in the catalog, `severity TEXT NOT NULL` with no CHECK in
`coach_observations`, `defaultSeverity: string` in `types.ts`). If
`defaultSeverity` override ships, there's no natural set of valid values to
validate against or render as selector options — that has to be invented
(the two catalog values currently in use are `"warning"` and `"info"`, but
nothing enforces that as the exhaustive set). Combined with §5's i18n
point (`severity` isn't rendered by `ObservationCard` at all today), this
is the part of the request most likely to be scope-cut to "kind only" for
v1 without losing anything visibly useful — worth raising back to PM/design
per the brief's own open question #3.

### 5.6 (Option B only) Fresh-DB-blind schema change

Exactly PROJECT-CONTEXT.md §9.5: `playbook_practice_config` is created via
`CREATE TABLE IF NOT EXISTS` (`server/db.js` line 1348), which already
exists in every installed DB. A bare column addition to that `CREATE TABLE`
statement is a guaranteed no-op on any pre-existing install. This only
applies if Option B (dedicated columns) is chosen — Option A sidesteps it
entirely by staying inside the existing untyped `config` JSON column.

## 6. Verification hooks

- **`server/__tests__/playbook.test.js`** — the primary and essentially
  only existing coverage of this whole surface. Specifically:
  - `describe("playbook engine")`'s `"respects a raised threshold
    override"` (line 142) and `"respects a raised account-weekly-balance
    gap threshold override"` (line 204) are the direct template for new
    tests: seed `dbModule.stmts.upsertPlaybookPracticeConfig.run(practiceId,
    1, JSON.stringify({ kindOverride: "risk" }))` then assert
    `engine.tick(dbModule)`'s created row has `kind === "risk"` instead of
    the catalog's `"info"` — this is the exact mechanical shape the new
    "engine reads the override at fire time" test should take.
  - `describe("playbook + coach routes")` → `describe("PUT
    /api/playbook/practices/:id/config")`'s `"400s on an unknown config
    field"` (line 340) is the test that will **catch a missed
    `validateConfigPatch` update** (§5.1) if it's run against a
    `kindOverride` patch and still expects a 400 — conversely, a new test
    here (`"persists a kind override and a follow-up GET reflects it"`,
    mirroring the existing `"persists an account-weekly-balance gap-threshold
    override"` at line 356) is the one that proves the fix actually works
    end-to-end through the route layer.
  - **Missing today, must be added**: the brief's explicit acceptance
    signal — "changing the override does NOT change any existing
    Observation's stored kind" — has no existing analog in this file. New
    test: create an Observation (engine tick with the catalog default
    kind), then change the stored override, tick again is insufficient
    (dedup would block a re-fire anyway) — the real test is: fetch the
    *existing* Observation row by id after changing
    `playbook_practice_config`'s stored override, and assert its `kind`/
    `severity` are unchanged from what was inserted, using
    `dbModule.stmts.getCoachObservation.get(id)` directly (same helper
    `evaluateSession`/`evaluateGlobal` already use internally, lines 101,
    149).
- **`server/__tests__/db-migration.test.js`** — only relevant if Option B
  is chosen. Its `describe("Migration meta-test")` (line 714) already
  fails CI automatically if a new `ALTER TABLE ... ADD COLUMN` ships
  without a matching `UPGRADE_CASES` entry (line 739-746) — this is an
  existing enforced tripwire, not something that needs to be newly built,
  just satisfied.
- **Client**: no existing test file specifically exercises
  `PlaybookPage.tsx` or `playbookStore.ts` was found via search of
  `client/src/__tests__`-style locations in the areas read for this
  assessment — worth flagging to QA/PM that the new selector UI and the
  preview-kind fix (§5.3) currently have **no** automated coverage on the
  client side; this would be new test surface, not an existing spec that
  "would catch a mistake" for the UI portion specifically.

## Summary of file list (for quick reference)

- `server/lib/playbook/practices.js` — `resolvePracticeConfig`
- `server/lib/playbook/engine.js` — `evaluateSession`, `evaluateGlobal`,
  `resolveEnabledPractices`
- `server/routes/playbook.js` — `serializePractice`, `validateConfigPatch`
- `server/openapi-extra/playbook-coach.js` — `PlaybookPractice`,
  `PlaybookConfigPatchRequest`, `CoachObservation` schemas + hand-written
  examples
- `client/src/lib/types.ts` — `PlaybookPractice` interface
- `client/src/lib/api.ts` — `playbook.updatePracticeConfig`
- `client/src/lib/playbookStore.ts` — `save`
- `client/src/pages/PlaybookPage.tsx` — `SessionTokenCeilingCard`,
  `AccountWeeklyBalanceCard`, new shared selector control
- `client/src/i18n/locales/{en,vi,zh,ko}/coach.json` — `kindLabel` (reusable
  as-is); new severity labels only if severity override ships
- (Option B only) `server/db.js` — migration block for
  `playbook_practice_config`; `server/__tests__/db-migration.test.js` —
  new `UPGRADE_CASES` entry
