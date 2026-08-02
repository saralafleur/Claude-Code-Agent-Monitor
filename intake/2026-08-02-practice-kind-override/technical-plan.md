# Technical Plan — Per-Practice `kind` / `defaultSeverity` Override

> Authored by `intake-tech-lead`, 2026-08-02. Synthesises
> `request-brief.md`, `supporting/architect.md`, `supporting/engineer.md`,
> `supporting/qa.md`, `supporting/product-owner.md`, `pm-plan.md`, and the
> binding decisions DEC-1 … DEC-4 in `decisions.md`.
>
> **This is one path, not a menu.** Where I overrode an upstream
> recommendation, it is called out inline under "Overrides".

---

## 1. Objective

Give the operator a per-practice override of a Playbook practice's `kind`
and `defaultSeverity`, set from the Playbook config UI, stored in the
existing `playbook_practice_config.config` JSON blob, and resolved by the
single shared `resolvePracticeConfig()` helper that both the Coach engine
(write path) and the Playbook route (read path) already read through.

End state: `resolvePracticeConfig()` becomes the **only** place in the
codebase where "this practice's effective kind/severity" is computed.
`engine.js`'s two `insertCoachObservation.run(...)` call sites, the route's
`serializePractice()`, and both client preview cards all read that one
resolved value; nothing reads `practice.kind` / `practice.defaultSeverity`
directly again, and a structural guard test fails if a new direct reader
appears. The resolved value is **frozen onto the `coach_observations` row at
fire time and never re-derived**, so changing an override later never
relabels an existing Observation. `defaultSeverity` is promoted to a
first-class enum in this build (value set pinned, DB `CHECK`, TS union,
i18n labels), and the stale `kind` enum table in
`coach-playbook-vocabulary.md` is corrected in the same effort.

---

## 2. Recommended approach

### 2.1 Confirmed from Architect + Engineer

**Option A confirmed.** The override lives in the existing untyped
`playbook_practice_config.config` TEXT/JSON blob, resolved through
`resolvePracticeConfig()`. No new table, no new column, no `ALTER TABLE …
ADD COLUMN`, no `UPGRADE_CASES` entry for the override mechanism itself.
Options B (dedicated columns) and C (new table) are rejected for the reasons
the Architect gives in `architect.md` §3, which I endorse without
modification.

Per **DEC-2**, the mechanism is generic: it is not a `fields[]` entry, not a
catalog flag, and not gated per practice. Every practice — `session-token-
ceiling`, `account-weekly-balance`, and every future one — gets it with zero
catalog edits.

### 2.2 Overrides of upstream recommendations

Three, each load-bearing.

---

#### Override 1 — the overrides are **top-level** patch/response fields, not keys inside `config`

The Architect, Engineer and orchestrator brief all assumed the override keys
would live *inside* the `config` object (`config: { gapThresholdPct: 25,
kindOverride: "risk" }` on the wire), which is why the brief flags
`validateConfigPatch` needing to "accept enum-valued keys, not just numeric
ones."

**I am overriding that on the wire shape only. Storage is unchanged — the
override keys are still persisted inside the same `config` JSON blob, so
Option A and the zero-DDL property hold exactly as decided.** What changes
is that the HTTP request/response and the client types carry them as
siblings of `enabled` and `config`, not nested inside `config`.

Reasoning:

1. **It keeps `config` numeric everywhere.** Nesting forces
   `Record<string, number>` → `Record<string, number | string | null>` in
   four places (`types.ts` `PlaybookPractice.config`, `api.ts`
   `updatePracticeConfig`, `playbookStore.ts` `save`, OpenAPI
   `additionalProperties`). That widening then poisons the numeric draft
   state in both cards — `PlaybookPage.tsx` line 258 does
   `draftValue * 1.024` on `draft[field.key]`, which stops typechecking the
   moment `draft` can hold a string or null. Engineer's §5.4 concern is
   almost entirely dissolved by not nesting.
2. **It is *more* generic, which is what DEC-2 asked for.** An override
   inside `config` is conceptually a per-practice field and invites a
   `fields[]` entry per practice (per-practice plumbing — the exact thing
   `practices.js`'s own header disclaims). A top-level field is universal by
   construction: no catalog entry declares it, so a future practice inherits
   it with literally zero work.
3. **It avoids two value shapes in one bag.** `validateConfigPatch`'s
   contract ("every key must match one of the practice's own `fields[].key`;
   every value must be a finite number ≥ `min`") stays true and unchanged,
   instead of becoming a two-branch function whose OpenAPI description has
   to be rewritten to say the opposite of what it says today.

**What this does NOT change:** the two-independent-validators hazard the
Engineer flagged (§5.1) is still real and still the highest-value thing to
double-check — it just moves from `validateConfigPatch` to a new sibling
`validateOverridePatch`. `resolvePracticeConfig()` (which reads stored
overrides) and the route (which validates incoming ones) remain two separate
functions that fail in **opposite** directions if only one is updated:

- miss the route validator → PUT 400s or silently accepts garbage;
- miss the resolver → PUT returns 200 and persists, and every read path
  ignores the stored override forever ("saved but never applied").

Step 3 below closes this structurally by having both read one exported enum
constant and one exported membership helper from `practices.js`, per PM's D2
("stop having two copies").

---

#### Override 2 — DEC-1's severity `CHECK` constraint **does** require DDL, contradicting the brief's "zero schema change"

The orchestrator brief states: *"This needs ZERO database schema/DDL change
(no `ALTER TABLE`), so it does not trigger this project's §9.5 FRESH-DB-BLIND
SCHEMA CHANGE pattern."*

**That is correct for the override mechanism and wrong for DEC-1's severity
`CHECK`.** These are two separate pieces of work bundled in one ticket, and
they have opposite schema risk:

- The override mechanism: zero DDL. Confirmed.
- DEC-1's *"add a `CHECK` constraint alongside `kind`'s in `server/db.js`"*:
  `coach_observations.severity` is `severity TEXT NOT NULL` with no `CHECK`
  (`server/db.js` line 1373). **SQLite cannot add a `CHECK` constraint to an
  existing table at all** — there is no `ALTER TABLE … ADD CONSTRAINT`, and
  `ALTER TABLE … ADD COLUMN` doesn't apply. This repo already knows this and
  wrote it down: `server/db.js` line 672 —
  *"SQLite cannot add a CHECK via ALTER TABLE ADD COLUMN at all, so shipping
  the base shape first would cost a full rebuild."*

So adding the `CHECK` only to the `CREATE TABLE IF NOT EXISTS
coach_observations` body would **silently no-op on every existing install**
— which is precisely §9.5 FRESH-DB-BLIND SCHEMA CHANGE, the defect class
this ticket was congratulating itself on avoiding.

**Decision: honour DEC-1, and do it properly — a guarded one-time table
rebuild**, following this repo's own established `sqlite_master.sql`-text-
guarded rebuild pattern (`plan_items` item_id rebuild, `server/db.js`
749-807; `plan_items` parent_item_id rebuild, 816-…; `webhook_targets`
1433-…; `agents` 1472-1513). Details and the mandatory safety rails are in
Step 2. This is the single largest risk item in the plan and is sequenced
first so it is reviewed on its own merits.

Note for whoever reviews the diff: the migration meta-test in
`db-migration.test.js` (line 714) only scans for `ALTER TABLE … ADD COLUMN`.
**It will not automatically catch this rebuild.** The migration test in Step
2.4 is therefore a required deliverable, not a tripwire we can lean on.

---

#### Override 3 — QA §3a's test snippet uses the wrong config key

QA's `playbook.test.js` snippet writes `JSON.stringify({ gapThresholdPct: 25,
kind: "risk" })`. The persisted key in this plan is **`kindOverride`**, not
`kind` (rationale in §4.1). Do not copy that snippet verbatim. Everything
else about QA's §3a five-step shape is adopted unchanged and is the
load-bearing acceptance test.

---

### 2.3 The severity enum value set (my call, per DEC-1)

**Ship exactly `["info", "warning"]`** — ordered low → high — as
`SEVERITY_VALUES`.

Reasoning:

1. **Data safety, and it is decisive.** The enum must be a superset of every
   value that already exists in `coach_observations.severity` on any
   install, or the Step-2 rebuild's row copy hits a `CHECK` violation *at
   `require("./db")` time*, which would brick the dashboard on boot. The
   only values the catalog has ever written are `"warning"`
   (`session-token-ceiling`) and `"info"` (`account-weekly-balance`). Pinning
   to exactly those two is the only choice provably safe against existing
   data.
2. **No speculative vocabulary.** Adding a `"critical"` nobody uses and
   nothing renders is how the `kind` enum drifted from its own spec in the
   first place (DEC-3). If severity ever needs a third value, widening one
   exported constant plus one `CHECK` is a small, deliberate follow-up —
   and it will be a *deliberate* one, on a value set that is written down.
3. `SEVERITY_VALUES` is defined once, exported from `practices.js`, and is
   the sole source for the DB `CHECK` text, the route validator, the TS
   union, and the selector's options.

**Naming collision to handle, not ignore:** English `kindLabel.risk` is
already "Warning". A severity option also labelled "Warning" would put two
different controls offering "Warning" on the same card, meaning different
things. The new `severityLabel` copy therefore reads as *urgency*, not
*nature* — see Step 8 for the exact strings.

---

### 2.4 The invariant this whole plan exists to protect

Read the override at **fire time**, freeze it onto the row, never re-derive.

- `resolvePracticeConfig()` resolves kind/severity → `resolveEnabledPractices()`
  attaches them once per tick → **both** `evaluateSession()` **and**
  `evaluateGlobal()` pass the resolved values into
  `insertCoachObservation.run(...)`.
- Nothing ever updates `coach_observations.kind`/`.severity` after insert
  (`updateCoachObservationStatus` touches only `status`/`responded_at` —
  confirmed). Keep it that way.
- **Do not** add a trigger, computed column, view, or backfill to "re-sync"
  historical Observations with a changed override. That would be the
  feature working backwards.

**§9.1 DERIVED-DUAL-VIEW is deliberately NOT applied in its usual form
here.** Its normal acceptance criterion is "same field, same value, across
every consumer." Applied to the live resolved kind vs. a frozen historical
`coach_observations.kind`, that criterion demands the **wrong** behaviour.
The two views are *supposed* to diverge after an override change; that
divergence is the feature. §9.1 **does** apply, in full force, to the four
*live* readers of "effective kind" (engine, route, both preview cards) —
they must all agree, always, and Step 6's structural guard enforces it. Any
review comment of the form "these two `kind` values don't match" must be
checked against which pair is meant before it is treated as a defect.

---

## 3. Change set

Ordered by layer; every path is repo-relative to
`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`.

### Server — data layer
| File | What changes |
|---|---|
| `server/db.js` | `coach_observations` `CREATE TABLE` body gains `CHECK(severity IN ('info','warning'))`; **plus** a new guarded rebuild block for existing installs (Step 2). No change to `playbook_practice_config`. |

### Server — catalog / resolver (the single source of truth)
| File | What changes |
|---|---|
| `server/lib/playbook/practices.js` | New exports `KIND_VALUES`, `SEVERITY_VALUES`, `coerceEnum(value, allowed)`. `resolvePracticeConfig()` return shape widens to `{ enabled, config, kindOverride, severityOverride, catalogKind, catalogSeverity, kind, severity }`. `PRACTICES` entries unchanged. `defaultConfigFor()` unchanged. |

### Server — engine (the two fire-time write sites)
| File | What changes |
|---|---|
| `server/lib/playbook/engine.js` | `resolveEnabledPractices()` already spreads the resolver — no change needed beyond the new members flowing through. `evaluateSession()` line 83 destructure + lines 97-98; `evaluateGlobal()` line 136 destructure + lines 145-146. Both stop reading `practice.kind`/`practice.defaultSeverity`. |

### Server — API
| File | What changes |
|---|---|
| `server/routes/playbook.js` | `serializePractice()` gains `kindOverride`, `severityOverride`, `resolvedKind`, `resolvedSeverity`; reads `kind`/`defaultSeverity` from the resolver's `catalogKind`/`catalogSeverity` instead of off `practice`. New `validateOverridePatch(body)`. `PUT` handler threads overrides with partial-patch discipline. `validateConfigPatch()` **unchanged**. |
| `server/openapi-extra/playbook-coach.js` | `PlaybookPractice` schema + `required`; `PlaybookConfigPatchRequest`; `CoachObservation.kind`/`.severity` descriptions; both hand-written example blocks (≈ lines 272-309 and 349-361). `PlaybookField` and `config.additionalProperties` stay `number`. |

### Client
| File | What changes |
|---|---|
| `client/src/lib/types.ts` | `PlaybookPractice` gains the four new fields; new exported `ObservationKind` / `ObservationSeverity` union types; `CoachObservation.severity` narrows from `string` to `ObservationSeverity`. |
| `client/src/lib/api.ts` | `updatePracticeConfig` patch type gains `kindOverride?` / `severityOverride?`; `config` stays `Record<string, number>`. |
| `client/src/lib/playbookStore.ts` | `save()` patch type mirrors `api.ts`; optimistic merge carries the two new fields; new exported `resolveDraftKind` / `resolveDraftSeverity` helpers (the one client-side resolution formula). |
| `client/src/pages/PlaybookPage.tsx` | New shared `OverrideSelects` control; wired into **both** `SessionTokenCeilingCard` and `AccountWeeklyBalanceCard`; **lines 257 and 335 preview `kind` fixed**; `isDirty` / `onSave` / `onReset` extended in both cards. |
| `client/src/i18n/locales/{en,vi,zh,ko}/coach.json` | New `severityLabel` block (2 keys) + new `playbook.*` selector-label keys, ×4 locales. `kindLabel` reused as-is — **verified present and complete in all four locales** (see §5). |

### Docs
| File | What changes |
|---|---|
| `library/knowledge/product/coach/coach-playbook-vocabulary.md` | Line ~98 `kind` enum corrected to `risk/info/good`; new `defaultSeverity` enum documented (DEC-3). |

### Tests
| File | What changes |
|---|---|
| `server/__tests__/playbook.test.js` | Frozen-snapshot regression (both scopes, both fields) + route-level override cases. |
| `server/__tests__/db-migration.test.js` | New severity-`CHECK` rebuild case. |
| `server/__tests__/playbook-resolver-guard.test.js` | **New file** — structural single-resolver guard. |
| `client/src/pages/__tests__/PlaybookPage.test.tsx` | Selector rendering, live-preview wiring, save payload. |

**14 files modified, 1 file added.**

---

## 4. Implementation steps

Dependency-ordered. Each step is independently checkable.

---

### Step 1 — Pin the enums in `server/lib/playbook/practices.js`

Add above `PRACTICES`:

```js
/** The only `kind` values `coach_observations.kind`'s CHECK accepts, and the
 *  only values a kind override may take. Single source for the DB CHECK
 *  text, the route validator, the TS union in client/src/lib/types.ts, and
 *  the client's kindLabel i18n keys. */
const KIND_VALUES = ["risk", "info", "good"];

/** The only `severity` values, pinned by this build (see intake
 *  2026-08-02-practice-kind-override, DEC-1). Ordered low -> high. Mirrors
 *  exactly the two values the catalog has ever written, so
 *  coach_observations' new CHECK can never reject pre-existing data. */
const SEVERITY_VALUES = ["info", "warning"];

/** Membership check shared by the resolver (which coerces an invalid stored
 *  value to null) and the route validator (which rejects an invalid incoming
 *  value with 400). Deliberately different dispositions, one shared vocabulary. */
function coerceEnum(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}
```

Export all three. **Checkable:** `node -e` require and assert the arrays.

**Why the resolver coerces and the route rejects:** the resolver runs inside
`resolveEnabledPractices()`, which is called from `tick()` line 156 —
*outside* the per-session and per-global `try/catch`. A throw there kills the
entire tick for every practice. The resolver must never throw; it fails safe
to the catalog default. The route, by contrast, must be loud, because a
rejected PUT is recoverable and a silently-dropped one is not. Do not
"unify" these two dispositions in review.

---

### Step 2 — `server/db.js`: pin severity at the DB layer (DEC-1)

This is the only DDL in the change and the highest-risk step. Four parts,
all required.

**2.1 — Declared schema.** In the `CREATE TABLE IF NOT EXISTS
coach_observations` body (line 1373), change:

```
severity TEXT NOT NULL,
```
to
```
severity TEXT NOT NULL CHECK(severity IN ('info','warning')),
```

This covers **fresh installs only**. On its own it is a §9.5 no-op — 2.2 is
what makes it real.

**2.2 — Guarded rebuild for existing installs.** Immediately after the
`coach_observations` `db.exec(...)` block, add a rebuild guarded on
`sqlite_master.sql` text, modelled on the `plan_items` rebuild at lines
749-807:

- Guard: `SELECT sql FROM sqlite_master WHERE type='table' AND
  name='coach_observations'`; proceed only if the text does **not** already
  contain `CHECK(severity IN`. This makes the block idempotent — a second
  startup is a no-op.
- **Pre-flight safety scan (mandatory):** before touching anything, run
  `SELECT COUNT(*) FROM coach_observations WHERE severity NOT IN
  ('info','warning')`. If the count is non-zero, **skip the rebuild entirely
  and leave the table as-is.** Do not rewrite the offending values — this
  feature's whole premise is that `coach_observations` rows are frozen
  historical facts, and silently rewriting one to satisfy a constraint would
  violate the invariant we are shipping. Do not throw either — `db.js` runs
  at `require` time, so a throw bricks the dashboard on boot. Tracked as
  **WATCH-3** in `decisions.md`.
- Rebuild: `PRAGMA foreign_keys = OFF` → `ALTER TABLE coach_observations
  RENAME TO coach_observations_old` → `CREATE TABLE coach_observations (…)`
  with the full new body **including the CHECK** → `INSERT INTO
  coach_observations SELECT * FROM coach_observations_old` inside a
  `db.transaction()` (preserves `id` values exactly, so the AUTOINCREMENT
  sequence lands on the same max) → `DROP TABLE coach_observations_old` →
  `PRAGMA foreign_keys = ON`.
- Recreate `idx_coach_observations_open` and
  `idx_coach_observations_detected_at` after the rebuild (they follow the
  renamed table and must be reissued — the existing `CREATE INDEX IF NOT
  EXISTS` statements in the block above already do this on the next line, so
  ensure the rebuild block sits *before* them or re-executes them).
- Header comment: name §9.5, name DEC-1, and state plainly that this
  migration must not change any column *value* — only the table's declared
  constraint.

**2.3 — No change to `playbook_practice_config`.** Confirm the diff touches
neither its `CREATE TABLE` nor `upsertPlaybookPracticeConfig`.

**2.4 — Migration test** (deliverable, not optional — see Override 2): see
Step 11.

**Checkable:** on a copy of a real DB, boot twice; second boot is a no-op;
`SELECT sql FROM sqlite_master` shows the CHECK; row count and every row's
values are identical before and after.

---

### Step 3 — `resolvePracticeConfig()` becomes the single resolver

Widen the return shape. Numeric merge loop unchanged.

```js
function resolvePracticeConfig(row, practice) {
  const config = defaultConfigFor(practice);
  const base = {
    config,
    catalogKind: practice.kind,
    catalogSeverity: practice.defaultSeverity,
  };
  if (!row) {
    return {
      ...base,
      enabled: true,
      kindOverride: null,
      severityOverride: null,
      kind: practice.kind,
      severity: practice.defaultSeverity,
    };
  }
  let stored = {};
  try { stored = JSON.parse(row.config) || {}; } catch { stored = {}; }

  for (const field of practice.fields) {           // unchanged
    const value = stored[field.key];
    if (typeof value === "number" && Number.isFinite(value) && value >= field.min) {
      config[field.key] = value;
    }
  }

  const kindOverride = coerceEnum(stored.kindOverride, KIND_VALUES);
  const severityOverride = coerceEnum(stored.severityOverride, SEVERITY_VALUES);
  return {
    ...base,
    enabled: !!row.enabled,
    kindOverride,
    severityOverride,
    kind: kindOverride ?? practice.kind,
    severity: severityOverride ?? practice.defaultSeverity,
  };
}
```

Notes:
- `catalogKind` / `catalogSeverity` exist so `serializePractice()` never has
  to read `practice.kind` directly — that is what lets Step 6's guard be the
  strict "only `practices.js`" form rather than a weaker allowlist.
- Update the function's JSDoc: its header currently claims to be the single
  source of truth for "defaults + stored overrides." That claim was true for
  `fields` and false for `kind`/`severity`. After this step it is true for
  both — say so, and say that the two `*Override` members are the *stored*
  values (`null` = unset) while `kind`/`severity` are the *effective* ones.

**Checkable:** unit-level — no row → catalog values; row with valid override
→ overridden; row with garbage override → catalog values, no throw.

---

### Step 4 — `engine.js`: both fire-time call sites, together

`resolveEnabledPractices()` (line 38-41) needs no edit — it already spreads
the resolver's output, so the new members flow through automatically.

**`evaluateSession()`** — line 83 and lines 93-100:
```js
for (const { practice, config, kind, severity } of sessionPractices) {
  …
  const info = stmts.insertCoachObservation.run(
    practice.id, "session", sessionId,
    kind, severity,                       // was: practice.kind, practice.defaultSeverity
    JSON.stringify(result.values)
  );
```

**`evaluateGlobal()`** — line 136 and lines 141-148: the identical change.

**Both, in the same commit. This is §9.4 FIX-ROUND-REGRESSION's exact
shape** (a change correct for the caller that motivated it, missing a
sibling caller). The two existing practices conveniently cover one scope
each — `session-token-ceiling` is session-scoped, `account-weekly-balance`
is global-scoped — so Step 10's tests must exercise **both**, not just the
global one from the worked example.

After this step, `grep -n "practice\.kind\|practice\.defaultSeverity"
server/lib/playbook/engine.js` must return **nothing**.

---

### Step 5 — `server/routes/playbook.js`: serialize + validate

**5.1 `serializePractice()`** (lines 33-46):

```js
function serializePractice(practice) {
  const row = stmts.getPlaybookPracticeConfig.get(practice.id);
  const r = resolvePracticeConfig(row, practice);
  return {
    id: practice.id,
    category: practice.category,
    scope: practice.scope,
    kind: r.catalogKind,               // catalog built-in — existing contract, unchanged meaning
    defaultSeverity: r.catalogSeverity,// catalog built-in — existing contract, unchanged meaning
    fields: practice.fields,
    enabled: r.enabled,
    config: r.config,                  // still numeric-only
    kindOverride: r.kindOverride,          // NEW: stored override or null
    severityOverride: r.severityOverride,  // NEW: stored override or null
    resolvedKind: r.kind,                  // NEW: effective value the engine would stamp now
    resolvedSeverity: r.severity,          // NEW
  };
}
```

`resolvedKind`/`resolvedSeverity` are technically derivable client-side from
`kindOverride ?? kind` — that is exactly why they are served instead:
computing them on the client would be a second copy of the resolution
formula in the display layer, which is §9.1's failure mode and precisely
what PM's D1 asks us to prevent.

**5.2 New `validateOverridePatch(body)`**, alongside (not inside)
`validateConfigPatch`:

```js
function validateOverridePatch(body) {
  for (const [key, allowed] of [
    ["kindOverride", KIND_VALUES],
    ["severityOverride", SEVERITY_VALUES],
  ]) {
    if (!(key in body)) continue;             // omitted -> unchanged
    const v = body[key];
    if (v === null) continue;                 // explicit clear -> back to catalog default
    if (coerceEnum(v, allowed) === null) {
      throw new ValidationError(`${key} must be null or one of: ${allowed.join(", ")}`);
    }
  }
}
```

Same shared `KIND_VALUES`/`SEVERITY_VALUES`/`coerceEnum` from Step 1 — one
vocabulary, two dispositions.

**5.3 `PUT /practices/:id/config` handler** (lines 78-107) — partial-patch
discipline, matching how `enabled` and `config` already behave (Architect
risk #4). Omitting an override key must **not** reset it:

```js
const enabled = body.enabled === undefined ? current.enabled : Boolean(body.enabled);
const config = { ...current.config };
try {
  if (body.config !== undefined) { validateConfigPatch(practice, body.config); Object.assign(config, body.config); }
  validateOverridePatch(body);
} catch (err) { /* unchanged 400 INVALID_CONFIG path */ }

const kindOverride     = "kindOverride"     in body ? body.kindOverride     : current.kindOverride;
const severityOverride = "severityOverride" in body ? body.severityOverride : current.severityOverride;

const stored = { ...config };
if (kindOverride !== null)     stored.kindOverride = kindOverride;
if (severityOverride !== null) stored.severityOverride = severityOverride;

stmts.upsertPlaybookPracticeConfig.run(practice.id, enabled ? 1 : 0, JSON.stringify(stored));
```

Use `in` (not `=== undefined`) so an explicit `null` reads as "clear" rather
than "omitted". Clearing drops the key from the persisted blob entirely,
which is what makes "unset ⇒ catalog default" true by construction.

`validateConfigPatch()` is **not modified**. The WebSocket broadcast needs
no change — `playbook_practice_config_updated` already carries the whole
serialised practice, so the new fields ride along for free.

**Checkable:** `PUT { config: { gapThresholdPct: 30 } }` on a practice that
already has a kind override must leave the override intact — this is the
regression that silently eats every save otherwise.

---

### Step 6 — `server/__tests__/playbook-resolver-guard.test.js` (new)

The structural guard PM's D1 asks for. Model on
`server/__tests__/single-writer-guard.test.js` (fs walk + regex + explicit
allowlist + an actionable failure message).

Three assertions:

1. **Server, strict:** `practice.kind` / `practice.defaultSeverity` appear in
   production code under `server/` (excluding `__tests__`) **only** in
   `server/lib/playbook/practices.js`. After Steps 3-5, that holds.
2. **Engine, sharpest:** zero occurrences in
   `server/lib/playbook/engine.js`. Called out separately from #1 so the
   failure message names §9.4 and both call sites explicitly.
3. **Client display path:** walk `client/src` for `.ts`/`.tsx` and assert
   `practice.kind` / `practice.defaultSeverity` appear only in
   `client/src/lib/types.ts` (the interface declaration). This is what
   catches a future contributor re-hardcoding the catalog value into a new
   preview — Engineer's §5.3, which no route- or engine-level test can see.

**§9.3 VACUOUS-GUARD compliance is mandatory here:** before merge, inject a
rogue `practice.kind` reader into `engine.js` and into a client card, watch
each assertion go **red**, then remove them. A guard that has never been
seen failing has not been proven to guard anything. Record that you did it
in the PR/commit message.

---

### Step 7 — OpenAPI: `server/openapi-extra/playbook-coach.js`

Same commit as Step 5, so the contract doc is never even briefly stale.

- **`PlaybookPractice`** (lines 70-122): add `kindOverride`
  (`type: "string", enum: KIND_VALUES, nullable: true`), `severityOverride`
  (`enum: SEVERITY_VALUES, nullable: true`), `resolvedKind`
  (`enum: KIND_VALUES`), `resolvedSeverity` (`enum: SEVERITY_VALUES`). Add
  all four to `required` (all are always present; the nullable ones are
  always *keys*, sometimes `null`). Tighten `kind`/`defaultSeverity`
  descriptions to say **"catalog built-in default"**, and add
  `enum: ["info","warning"]` to `defaultSeverity` — it is a pinned enum as of
  this build.
- **`PlaybookConfigPatchRequest`** (lines 136-154): add optional top-level
  `kindOverride`/`severityOverride` (nullable; `null` = clear, omitted =
  unchanged). **Leave `config.additionalProperties: { type: "number" }` and
  its "every key must match one of the practice's own `fields[].key`"
  sentence exactly as they are** — under Override 1 that sentence stays
  true. (The Engineer's note that this line "becomes false the moment this
  ships" applies to the nested design, not this one.)
- **`CoachObservation`** (lines 192-201): change `kind`'s description from
  *"Copied from the practice's own `kind` at detection time"* to *"The
  **resolved** kind (catalog default, or the practice's `kindOverride` if
  set) frozen at detection time. Never re-derived: changing an override
  later does not relabel existing Observations."* Same for `severity`, and
  add `enum: ["info","warning"]` to it.
- **Both hand-written example blocks** (≈ lines 272-309 and 349-361) are
  literal JSON, not generated — update them or they silently lie.

---

### Step 8 — i18n: all four locales

`client/src/i18n/locales/{en,vi,zh,ko}/coach.json`.

**`kindLabel` needs no change** — I verified all three keys
(`risk`/`info`/`good`) are present and structurally identical in all four
locale files (en/vi/zh/ko), which closes QA §1 item 6 and the brief's open
question 5. Reuse via `t(\`kindLabel.${value}\`)`, the same lookup
`ObservationCard.tsx` line 110 already does.

**New `severityLabel` block**, sibling of `kindLabel`. Copy reads as
*urgency*, deliberately avoiding "Warning" so it doesn't collide with
`kindLabel.risk` on the same card (see §2.3):

| key | en | vi | zh | ko |
|---|---|---|---|---|
| `severityLabel.info` | Normal | Bình thường | 常规 | 일반 |
| `severityLabel.warning` | Elevated | Cần chú ý | 需关注 | 주의 |

The non-`en` strings are proposed, not authoritative — have them sanity-
checked against the tone of the neighbouring `kindLabel` entries before
merge. Do **not** ship a locale with the key missing; an absent key renders
the raw key string to the user.

**New selector-chrome keys** under the existing `playbook.*` namespace, ×4
locales — at minimum: `playbook.kindOverrideLabel`,
`playbook.severityOverrideLabel`, and `playbook.useDefaultOption` (rendered
with the catalog value interpolated, e.g. *"Use default (Reminder)"*).

---

### Step 9 — Client

**9.1 `client/src/lib/types.ts`**

```ts
export type ObservationKind = "risk" | "info" | "good";
export type ObservationSeverity = "info" | "warning";
```

`PlaybookPractice` gains:
```ts
  kind: ObservationKind;              // catalog built-in (unchanged meaning)
  defaultSeverity: ObservationSeverity; // was `string` — now the pinned enum
  kindOverride: ObservationKind | null;
  severityOverride: ObservationSeverity | null;
  resolvedKind: ObservationKind;
  resolvedSeverity: ObservationSeverity;
  config: Record<string, number>;     // UNCHANGED — stays numeric
```
`CoachObservation.severity` narrows `string` → `ObservationSeverity`.

**9.2 `client/src/lib/api.ts`** (line 2170-2177): patch type becomes
`{ enabled?: boolean; config?: Record<string, number>; kindOverride?: ObservationKind | null;
severityOverride?: ObservationSeverity | null }`. Update the JSDoc at 2167
to describe the null-clears semantics.

**9.3 `client/src/lib/playbookStore.ts`** (`save`, lines 117-133): same patch
type; the optimistic merge must carry the two override fields *and*
recompute `resolvedKind`/`resolvedSeverity` locally so the preview doesn't
flicker before the server response lands. Export the one client-side
resolution helper used everywhere:

```ts
export const resolveKind = (p: PlaybookPractice, draft: ObservationKind | null | undefined) =>
  (draft !== undefined ? draft : p.kindOverride) ?? p.kind;
```
(and the severity twin).

**§9.1 documented-duplication note, required:** this helper *is* a second
copy of the server's resolution formula, and it is unavoidable — the server
cannot resolve a value the user has not saved yet, and the live preview's
entire purpose (per `PlaybookPage.tsx`'s own header, line 20) is to reflect
what is currently being edited. Per §9.1's "How to comply", document it in
`playbookStore.ts`'s file header: name the risk, state why extraction to the
server isn't possible, and state the bound — **the duplicate is used only
for unsaved draft state; on save it is replaced by the server's
`resolvedKind`/`resolvedSeverity`, so divergence cannot outlive one save.**
`client/src/lib/windowedTotals.ts` is the precedent for the comment's shape.

**9.4 `client/src/pages/PlaybookPage.tsx`**

New shared control next to `PracticeCardActions` (lines 102-141), which is
the established "shared card chrome" seam:

```tsx
function OverrideSelects({ practice, kindDraft, severityDraft, onKind, onSeverity })
```
Two `<select>`s. Each has a first option `""` → `null` rendering
`t("playbook.useDefaultOption", { value: t(`kindLabel.${practice.kind}`) })`,
then one option per enum value labelled from `kindLabel` /
`severityLabel`. **All values freely selectable, no ordering, no disabling
(DEC-4).**

Wire into **both** cards (per DEC-2 the control is generic; because the two
cards are bespoke components with no shared field renderer, "generic" still
means adding the same shared component to each):

- new state `kindDraft` / `severityDraft`, seeded from
  `practice.kindOverride` / `practice.severityOverride`;
- `isDirty` (lines 180 and 284) extended with
  `|| kindDraft !== practice.kindOverride || severityDraft !== practice.severityOverride`;
- `onSave` (lines 267 and 351) payload extended with
  `kindOverride: kindDraft, severityOverride: severityDraft`;
- `onReset` (lines 268 and 352) also clears both drafts to `null`.

**The preview fix — do not skip this.** Lines **257** and **335** currently
pass `kind={practice.kind}` (the bare catalog value) into `<ObservationCard>`.
Both become:

```tsx
kind={resolveKind(practice, kindDraft)}
```

Without this, the operator selects "Warning", saves successfully, and the
preview card directly beneath the control still reads "Reminder" — a
visibly broken feature that no server-side test can see (Engineer §5.3).

**Also add a one-line comment in the card, not only in this plan:** the
severity selector has no visible effect anywhere in the product —
`ObservationCard.tsx` never renders `severity` (confirmed). It is persisted
and frozen correctly onto Observations; it is simply not displayed yet.
Tracked as **WATCH-2**.

---

### Step 10 — `server/__tests__/playbook.test.js`

See §5.

---

### Step 11 — `server/__tests__/db-migration.test.js`

See §5.

---

### Step 12 — `client/src/pages/__tests__/PlaybookPage.test.tsx`

See §5.

---

### Step 13 — Doc fix (DEC-3)

`library/knowledge/product/coach/coach-playbook-vocabulary.md`, the
"Additional modeling requirements" bullet at **line 98**:

- Correct the `kind` enum from
  `opportunity / risk / reinforcement / reminder / standard` to
  **`risk / info / good`**, matching `coach_observations`'
  `CHECK(kind IN ('risk','info','good'))`, `PRACTICES[].kind`, and the
  `kindLabel` i18n keys in all four locales.
- Record the correction inline and dated, e.g.:
  *"Corrected 2026-08-02: the shipped implementation (`b6d372b`, 2026-08-02)
  uses `risk`/`info`/`good`; the five-value set above was never built. The
  code is the source of truth — the DB CHECK constraint and four locale
  files already encode it. See `intake/2026-08-02-practice-kind-override/`
  DEC-3."*
- Document the `severity` enum, which did not exist when this doc was
  written: **`info` / `warning`**, pinned by this build, enforced by
  `coach_observations`' new `CHECK(severity IN ('info','warning'))` and by
  `SEVERITY_VALUES` in `server/lib/playbook/practices.js`.
- Document that both `kind` and `severity` are now per-practice overridable
  via `playbook_practice_config.config`'s `kindOverride`/`severityOverride`
  keys, resolved at fire time and frozen onto the Observation row.

This is a doc correction only — it changes no runtime behaviour. Do **not**
let it expand into a vocabulary re-derivation; the shipped enum wins.

---

## 5. Single-source-of-truth guardrail

**This change touches this project's canonical-resolver surface, and it must
route through it. This is not advisory.**

The canonical registry here is **`resolvePracticeConfig()` in
`server/lib/playbook/practices.js`**, whose own header already claims to be
*"the single source of truth for 'defaults + stored overrides' both the
engine … and the route … read through, so the two can never silently
disagree about what's actually configured."* Today that claim is **true for
`practice.fields` and false for `kind`/`defaultSeverity`**, which route
around the resolver entirely — four independent hand-written readers of
"this practice's effective kind" exist right now (`engine.js` ×2,
`serializePractice()`, `PlaybookPage.tsx` ×2 preview lines). They agree only
because the value cannot vary. **This feature makes it vary.**

Binding rules for this build:

1. **Every** consumer of effective kind/severity reads
   `resolvePracticeConfig()`'s output. Nobody hand-edits one path.
2. No per-practice special case anywhere — DEC-2 is generic, and a
   `if (practice.id === "account-weekly-balance")` branch would recreate the
   two-codepaths-for-one-fact shape §9.1 names.
3. The enum vocabulary lives in exactly one place (`KIND_VALUES` /
   `SEVERITY_VALUES`, Step 1) and is consumed by the DB `CHECK` text, the
   route validator, the TS unions, and the selector options. Three separate
   hand-copied enum lists is how the `kind` enum drifted from its own spec
   in the first place (DEC-3).
4. The rule is **enforced structurally, not by review**, by
   `playbook-resolver-guard.test.js` (Step 6) — which must itself be proven
   red per §9.3 before it counts.

**Explicit non-application of §9.1's usual criterion:** §9.1's acceptance
bar is "same field, same value, across every consumer." Do **not** apply
that to the pair (live resolved kind, frozen `coach_observations.kind`).
Those two are supposed to diverge after an override change — that divergence
*is* the feature, and a test asserting they match would demand the wrong
behaviour. §9.1 applies in full to the four *live* readers listed above, and
not at all across the fire-time freeze boundary. Any reviewer citing §9.1
here must state which pair they mean.

---

## 6. Testing & verification

Test stack (from QA, confirmed): server = `node:test` + `node:assert/strict`
via `npm run test:server`; client = Vitest + Testing Library via
`npm run test:client`; both via root `npm test`. Node's runner has no
per-test name filter — isolate with `it.only` or by running the single file.

**Baseline first:** `npm test` green before any edit, so a later failure is
attributable.

### 6.1 The load-bearing test — frozen snapshot (QA §3a, adopted)

`server/__tests__/playbook.test.js`, in `describe("playbook engine")`, next
to `"respects a raised account-weekly-balance gap threshold override"`.
QA's five-step shape, with two mandatory amendments:

- **Use key `kindOverride`, not `kind`** (Override 3):
  `JSON.stringify({ gapThresholdPct: 25, kindOverride: "risk", severityOverride: "warning" })`.
- **Assert `severity` alongside `kind` at every step** (DEC-1). Severity is
  invisible in the product, so this test is the *only* place its correctness
  is ever demonstrated.

Shape: fire with no override → assert `kind === "info"`, `severity === "info"`
→ `updateCoachObservationStatus.run("dismissed", …)` so dedup allows a refire
→ set override to `risk`/`warning` → tick → assert the **new** row is
`risk`/`warning` → change the override again to `good`/`info` → re-fetch
**both prior rows** via `dbModule.stmts.getCoachObservation.get(id)` and
assert their `kind`/`severity` are byte-unchanged.

**Twin test for the session scope** using `seedSession`/`seedTokens` +
`session-token-ceiling`. This is not optional duplication: `evaluateSession`
and `evaluateGlobal` are two independent call sites, and §9.4
FIX-ROUND-REGRESSION is exactly "the fix landed on the caller that motivated
it and missed the sibling." A green global-scope test proves nothing about
the session-scope call site.

**§9.3 red-first proof, required:** both tests must be shown failing against
pre-change code (they will: the engine writes the catalog value). A
frozen-snapshot test that passes trivially because nothing ever updates the
row is the vacuous shape §9.3 names.

### 6.2 Route-level (QA §3b, adopted + extended)

In `describe("PUT /api/playbook/practices/:id/config")`:

- `"persists a kind override and a follow-up GET reflects resolvedKind"` —
  PUT `{ kindOverride: "risk" }`; assert the response and a follow-up
  `GET /api/playbook/practices` both show `kindOverride: "risk"` and
  `resolvedKind: "risk"`, while `kind` still reads the catalog `"info"`.
- `"400s on an invalid kind value"` — PUT `{ kindOverride: "not-a-kind" }`
  → 400 `INVALID_CONFIG`. Twin for `severityOverride: "critical"` (proves
  the pinned two-value set is actually enforced).
- `"clearing an override reverts to the catalog default"` — PUT
  `{ kindOverride: null }`; assert `kindOverride: null` and
  `resolvedKind === kind`.
- **`"a numeric-only config PUT does not clear an existing override"`** —
  set an override, then PUT `{ config: { gapThresholdPct: 30 } }`; assert
  the override survives. Architect risk #4; this is the regression that
  silently eats every save.
- `"overriding one practice does not affect another"` — one `GET` returns
  the whole catalog, so this is nearly free.
- Existing `"400s on an unknown config field"` must still pass unchanged —
  under Override 1 `validateConfigPatch` is untouched, so it should.

### 6.3 Structural guard — `playbook-resolver-guard.test.js`

Step 6. Prove red by injecting a rogue reader in `engine.js` and in a client
card; remove; note it in the commit message.

### 6.4 Migration — `server/__tests__/db-migration.test.js`

The meta-test at line 714 scans only `ALTER TABLE … ADD COLUMN` and will
**not** catch this rebuild, so this case is a required deliverable. Seed a
legacy `coach_observations` (the current shape, `severity TEXT NOT NULL`,
no CHECK) with rows of both `'info'` and `'warning'`, then run the
migration and assert:

1. `sqlite_master.sql` now contains `CHECK(severity IN`;
2. **every pre-existing row is byte-identical** (all columns, same `id`s,
   same order) — this is the frozen-snapshot invariant applied to the
   migration itself;
3. both indexes exist again;
4. inserting `severity = 'critical'` now fails;
5. running the migration a second time is a clean no-op;
6. **pre-flight skip:** with a seeded out-of-enum row present, the migration
   leaves the table untouched and **does not throw** (WATCH-3). A throw here
   would brick the app at boot, since `db.js` runs at require time.

Do not add anything to `GRANDFATHERED`.

### 6.5 Client — `PlaybookPage.test.tsx`

Extend `ACCOUNT_BALANCE_PRACTICE` / `PRACTICE` fixtures with the four new
fields (don't clone a parallel fixture shape). Add:

- `"renders kind and severity selectors defaulted to 'use default'"` — with
  `kindOverride: null`, the kind select shows the use-default option naming
  "Reminder".
- **`"changing the kind selector updates the live preview before saving"`** —
  select "Warning", assert the preview `ObservationCard` re-renders with the
  risk label **without** a save. This is the one test that catches Engineer
  §5.3 / the lines-257-and-335 regression; nothing on the server can.
- `"saving sends kindOverride in the patch"` — `waitFor(() =>
  expect(updatePracticeConfig).toHaveBeenCalledWith(id,
  expect.objectContaining({ kindOverride: "risk" })))`.
- `"selecting 'use default' sends null"`.
- Run for **both** card fixtures (DEC-2 — the control is on every card).
- Carry QA §3d's note **into the test file as a comment**: this screen shows
  only the live resolved value, never any Observation's frozen value, so
  there is no dual-value cross-check to add here — do not add a "UI must
  match Feed" assertion.

### 6.6 Manual walkthrough (once, against a dev server + real DB)

QA §1 steps 1-5, plus one addition: **before** starting, take a copy of the
real DB and boot the built server against it twice, confirming the Step-2
rebuild runs once, is a no-op the second time, and leaves every
`coach_observations` row's values unchanged. QA §1 item 6 (locale
completeness for `kindLabel`) is already **verified** — all four locales
carry all three keys — but re-verify the *new* `severityLabel` keys in all
four.

### 6.7 Commands

```
npm test                          # baseline, and again at the end
npm run test:server
node --test server/__tests__/playbook.test.js
node --test server/__tests__/db-migration.test.js
node --test server/__tests__/playbook-resolver-guard.test.js
cd client && npx vitest run src/pages/__tests__/PlaybookPage.test.tsx
```

---

## 7. Risks & rollback

### 7.1 Top risks, in order

| # | Risk | Watch for | Mitigation |
|---|---|---|---|
| R1 | **The `coach_observations` rebuild (Step 2) is the only DDL and the only thing that can brick the app**, because `db.js` runs at `require` time. | Dashboard fails to boot after upgrade. | Pre-flight scan + skip-don't-throw + skip-don't-rewrite; idempotency guard on `sqlite_master.sql` text; migration test 6.4 items 2/5/6; manual double-boot against a copy of the real DB. |
| R2 | **One of the two engine call sites is missed** (§9.4). | Global-scope Observations honour the override, session-scope ones don't (or vice versa). | Both changed in one commit; twin frozen-snapshot tests per scope (6.1); guard assertion #2 (zero `practice.kind` in `engine.js`). |
| R3 | **Resolver updated but route validator not, or vice versa** (Engineer §5.1) — fails silently in opposite directions. | PUT 400s on every save, **or** PUT 200s and the override never applies. | One shared `KIND_VALUES`/`SEVERITY_VALUES`/`coerceEnum`; route tests cover both directions (6.2); the "saved but never applied" direction is specifically covered by asserting a follow-up `GET` shows `resolvedKind`. |
| R4 | **Preview lines 257/335 not updated** (Engineer §5.3). | Operator picks "Warning", saves, preview underneath still says "Reminder". No server test can see this. | Client test 6.5 item 2; guard assertion #3 scans `client/src`. |
| R5 | **A numeric-field save silently clears an existing override** (Architect #4). | Override disappears after editing a threshold. | `in`-based partial-patch discipline (Step 5.3); route test 6.2 item 4. |
| R6 | **A reviewer applies §9.1's usual criterion by rote** and demands old Observations be "re-synced" to a changed override. | Any suggestion of a trigger, computed column, view, or backfill on `coach_observations`. | §5 of this plan states the non-application explicitly; QA DoD carries it; reject on sight. |
| R7 | **`severityLabel` copy** is authored by a non-translator for vi/zh/ko. | Awkward or wrong-register strings. | Marked as proposed in Step 8; sanity-check before merge; a missing key is worse than an imperfect one (raw key renders to the user). |

### 7.2 Rollback

The change is cleanly reversible in two independent halves.

- **Application half (Steps 1, 3-13):** pure revert. Any `kindOverride` /
  `severityOverride` keys left in `playbook_practice_config.config` become
  inert — the pre-change `resolvePracticeConfig()` ignores every non-numeric
  stored key by construction, and `validateConfigPatch` never saw them. No
  cleanup needed. Observations already stamped with an overridden
  kind/severity keep their frozen values, which is correct: they record what
  the practice meant when they fired.
- **Migration half (Step 2):** *not* auto-reverting. Reverting the code
  leaves the `CHECK(severity IN ('info','warning'))` in place on any DB that
  already rebuilt. That is harmless — the reverted engine only ever writes
  `'info'`/`'warning'` from the catalog anyway. Do **not** write a
  down-migration; a second full rebuild to remove a constraint that
  constrains nothing is strictly more risk than leaving it. If the
  constraint must genuinely go, restore from the backup taken before the
  upgrade.
- **Backup:** take a DB copy before first boot of the new build. This is the
  only step in this plan that rewrites a table.

### 7.3 Scope boundaries declined now — each backed by a tracked artifact

Per this pipeline's rule, nothing below is disclosed in prose alone.

| Boundary declined | Tracked as |
|---|---|
| Distinct overrides per *human user* (this app has no user-identity model; "per-user" = the existing global singleton). Carried forward from `architect.md` §4.5/§4.6, which explicitly asked that this not be left as prose in a file nobody re-reads. | **WATCH-1**, `decisions.md` (PARKED) |
| The severity selector controls a value nothing in the product renders — `ObservationCard.tsx` never displays `severity`. We ship a working, correctly-frozen control with no visible effect, verified at the data layer only. | **WATCH-2**, `decisions.md` (added by this plan) |
| On any install holding a `coach_observations.severity` value outside `{info, warning}`, the Step-2 rebuild deliberately **skips**, leaving that install without the DB-level constraint (app-layer enum still applies). Chosen over rewriting frozen historical rows or throwing at boot. | **WATCH-3**, `decisions.md` (added by this plan) |
| Binding the un-intake'd-capability routing rule into this repo's `PROJECT-CONTEXT.md` (PM's D4) — does not block this build. | **DEC-5**, `decisions.md` (PENDING) |

One boundary is **not** declined and needs no row: the client-side draft
resolution helper (Step 9.3) duplicates the server's formula. That is
*addressed*, via §9.1's own documented-duplication route — named in
`playbookStore.ts`'s header, with a stated bound (the duplicate is
draft-only and is replaced by the server's value on save).

---

## 8. Definition of Done

Merge blocked until every box is ticked.

**Behaviour**
- [ ] `resolvePracticeConfig()` returns `{ enabled, config, kindOverride, severityOverride, catalogKind, catalogSeverity, kind, severity }`; overrides default to the catalog value when unset; an invalid stored value coerces to the catalog default **without throwing**.
- [ ] `evaluateSession()` **and** `evaluateGlobal()` both pass the resolved kind/severity into `insertCoachObservation.run(...)`. `grep "practice\.kind\|practice\.defaultSeverity" server/lib/playbook/engine.js` returns nothing.
- [ ] `GET /api/playbook/practices` and the config `PUT` both return `kindOverride`, `severityOverride`, `resolvedKind`, `resolvedSeverity`; `kind`/`defaultSeverity` still mean the catalog built-in.
- [ ] `PUT` accepts top-level `kindOverride`/`severityOverride`; `null` clears; omitted leaves unchanged; an invalid value 400s `INVALID_CONFIG`. `validateConfigPatch()` is unmodified and `config` is still numeric-only end to end.
- [ ] Both practice cards render both selectors; all values freely selectable including downgrades (DEC-4); the live preview reflects the **draft** selection before saving (lines 257 and 335 fixed).
- [ ] Setting an override survives reload and propagates to other connected clients via the existing `playbook_practice_config_updated` broadcast.
- [ ] The mechanism is generic (DEC-2) — no per-practice branch anywhere; adding a future practice requires no override plumbing.

**Schema**
- [ ] `coach_observations.severity` has `CHECK(severity IN ('info','warning'))` on fresh installs **and** on upgraded ones.
- [ ] The rebuild is idempotent, preserves every row's values and `id`s byte-for-byte, recreates both indexes, and skips (does not throw, does not rewrite) if any out-of-enum value exists.
- [ ] `playbook_practice_config` schema untouched; no `ALTER TABLE … ADD COLUMN` anywhere in the diff; nothing added to `GRANDFATHERED`.

**Tests**
- [ ] Frozen-snapshot regression passes for **both** `kind` and `severity`, across **both** the global- and session-scoped practices; **proven red against pre-change code** (§9.3).
- [ ] Route tests: valid override, invalid-value 400 (kind *and* severity), clear-to-default, numeric-PUT-preserves-override, no cross-practice bleed.
- [ ] `playbook-resolver-guard.test.js` exists and passes, and its red state was demonstrated by injecting a rogue `practice.kind` reader in both `engine.js` and a client card (say so in the commit message).
- [ ] `db-migration.test.js` covers all six assertions in §6.4.
- [ ] `PlaybookPage.test.tsx` covers selector render, **live-preview update before save**, save payload, and clear-to-null — for both card fixtures.
- [ ] No test anywhere asserts "live resolved kind == a stored Observation's kind" post-override.
- [ ] `npm test` green (server + client).

**Docs & i18n**
- [ ] OpenAPI schemas *and* both hand-written example blocks updated; `CoachObservation.kind`/`.severity` descriptions say "resolved … frozen at detection time".
- [ ] `severityLabel.info` / `severityLabel.warning` and the new `playbook.*` selector keys present in **all four** locales; `kindLabel` untouched.
- [ ] `coach-playbook-vocabulary.md` `kind` enum corrected to `risk/info/good` with a dated inline note citing DEC-3; the new `severity` enum documented; the override mechanism documented (DEC-3, Step 13).
- [ ] `playbookStore.ts` header carries the §9.1 documented-duplication note with its stated bound.
- [ ] WATCH-2 and WATCH-3 rows exist in `decisions.md`.

**Ops**
- [ ] DB backup taken before first boot of the new build.
- [ ] Manual walkthrough (§6.6, including the double-boot migration check) performed once against a running dev server.
