# Coverage Map — practice-kind-override

> Authored by `qa-coverage-cartographer`. Maps *existing* test coverage for
> the surfaces this change touches, before any code changes. Pre-build
> intake — nothing listed below as "new" exists yet in the tree at the time
> of this pass (confirmed live against HEAD).

## 0. Test stack (discovered)

Per `package.json` scripts (no test-stack override in `PROJECT-CONTEXT.md`
beyond the defect-catalog notes already cited in the change brief):

- **Server** — Node's built-in test runner (`node:test` + `node:assert/strict`).
  Run: `node --test server/__tests__/*.test.js` (`npm run test:server`).
  One spec file per module/surface, `server/__tests__/<name>.test.js`.
  Structural/meta-tests live in the same directory, named for what they guard
  (`single-writer-guard.test.js`, `chronology-ordering.test.js`,
  `db-migration.test.js`).
- **Client** — Vitest + Testing Library + jsdom (`client/vitest.config.ts`).
  Run: `cd client && npx vitest run <path>` (`npm run test:client` → `vitest run`).
  One spec file per page/component, `client/src/pages/__tests__/<Page>.test.tsx`
  or `client/src/components/__tests__/<Component>.test.tsx`.
- No separate integration/e2e/tag-bucketed suite exists in this repo (no
  Playwright/Cypress config, no smoke/regression project split found) — the
  server suite's route-level `describe("playbook + coach routes", ...)` block
  (real Express app + real HTTP requests against a temp SQLite file) *is*
  this project's integration layer for API surfaces; there is no separate
  e2e layer to check.
- MCP suite (`npm run test:mcp`) and desktop suite (`npm run desktop:test`)
  exist but do not touch this surface — not run.

## 1. Existing coverage by surface

### `server/lib/playbook/practices.js` (resolver / catalog)

No dedicated unit-test file exists for `resolvePracticeConfig()` in
isolation. It is exercised only indirectly, through the engine and route
tests below, and only on its **numeric-field-merge** behavior:

- `server/__tests__/playbook.test.js`:
  - `"respects a raised threshold override"` (line 142) and `"respects a
    raised account-weekly-balance gap threshold override"` (line 204) —
    exercise `resolvePracticeConfig()`'s numeric `config` merge via
    `engine.tick()`.
  - `"does not evaluate a disabled practice"` (129) / `"...disabled
    account-weekly-balance practice"` (217) — exercise the `enabled` merge.
  - Route test `"persists an enabled/config patch..."` (314) and
    `"persists an account-weekly-balance gap-threshold override"` (356) —
    exercise the same resolver through `serializePractice()`.
- **Nothing exercises `kind`/`defaultSeverity` through the resolver at all**
  — today there is no override path for them (`resolvePracticeConfig()`
  literally does not read or return those fields; confirmed at
  `practices.js:101-117`), so there is nothing yet to test. This is the
  surface the change adds, not one that regresses if untested today.

### `server/lib/playbook/engine.js` (`evaluateSession`, `evaluateGlobal`)

`server/__tests__/playbook.test.js`, `describe("playbook engine")` block
(lines 18-229) is the only coverage:

- Fires/does-not-fire/dedup/re-fire/disabled/threshold-override for
  `session-token-ceiling` (lines 78-161).
- Fires/does-not-fire/dedup/threshold-override/disabled for
  `account-weekly-balance` (163-228).
- Every one of these tests asserts `practice_id`, `scope_type`, `scope_id`,
  `status`, and the practice-specific `values_json` fields
  (`totalTokens`/`thresholdTokens`, `gapPct`/`lowAccountId`/`highAccountId`).
- **None of these tests reads or asserts `created[0].kind` or
  `created[0].severity`.** `grep -n "\.kind\b|\.severity\b"
  server/__tests__/playbook.test.js` returns zero matches. The engine writes
  `practice.kind`/`practice.defaultSeverity` bare into every inserted row
  (`engine.js:97-98`, `145-146`) today, and no test in the suite would catch
  either value being wrong, swapped, or (post-change) failing to reflect an
  override.

### `server/routes/playbook.js` (`GET /practices`, `PUT /:id/config`, serializer)

Same file, `describe("playbook + coach routes")` block (231-435):

- `GET /api/playbook/practices` — asserts catalog length, `enabled`,
  `config` for both practices (294-311). **Does not assert `kind` or
  `defaultSeverity` in the response body at all**, despite
  `serializePractice()` including both fields (`routes/playbook.js:40-41`).
- `PUT /:id/config` — enabled/config patch persists and round-trips (314-332,
  356-367); 404 unknown practice; 400 unknown config field; 400 below-min
  value. No override-shaped field exists yet to patch, so none is tested.
- `GET /api/coach/observations` + `POST .../respond` — list/filter/respond
  round-trip. The two observations seeded here (377, 407) hardcode
  `"risk"`/`"warning"` directly into `insertCoachObservation.run(...)` as
  literal test fixture data, not as an assertion that the *engine* or
  *route* produced those values — this is route-plumbing coverage for
  `status`/`responded_at`, unrelated to kind/severity correctness.

### `server/db.js` — `playbook_practice_config` + `coach_observations`

- No dedicated schema test file; both tables are only exercised indirectly
  via the `stmts.*` calls used throughout `playbook.test.js` (inserts,
  upserts, listing).
- `coach_observations.severity` today is `TEXT NOT NULL` with **no CHECK**
  (`db.js:1373`) — nothing in the suite asserts a severity value is
  constrained, because nothing constrains it yet.
- `coach_observations.kind` **does** have `CHECK(kind IN ('risk','info','good'))`
  (`db.js:1372`) but no test in the repo exercises that constraint directly
  (e.g. inserting an out-of-enum kind and expecting a SQLite error) — it is
  covered only by construction, in that every current write path passes a
  value from the fixed `PRACTICES` catalog.
- See §3 below for the migration-specific gap (`db-migration.test.js`).

### `client/src/pages/PlaybookPage.tsx` + `client/src/lib/playbookStore.ts`

`client/src/pages/__tests__/PlaybookPage.test.tsx` (10 tests, all passing —
see §4) covers, **today**:

- Renders the practice name + comma-formatted current threshold (71).
- Live preview reacts to the (unsaved) threshold field as it's typed (77,
  162) and to a shorthand-parsed/reformatted value (88).
- Invalid input disables Save (101).
- Preset chip sets the field and is reflected in the save payload (111).
- Enabled/config patch round-trips through `api.playbook.updatePracticeConfig`
  for both cards (128, 174).
- Renders one card per catalog practice (148); renders
  `account-weekly-balance`'s current gap + preview (155).

None of these tests touch `kind`/`defaultSeverity` — the fixture `PRACTICE`
/`ACCOUNT_BALANCE_PRACTICE` objects at the top of the file (lines 16-38)
hardcode `kind`/`defaultSeverity` as static fixture fields, but **no test
asserts what value is passed into `<ObservationCard kind=... />`** — the two
production call sites this change must fix
(`PlaybookPage.tsx:257`, `:335`) are read but never asserted on. A test
suite this green today would stay exactly this green even if the preview
silently continued showing the catalog kind after an operator changed the
override (the exact WATCH-2/live-preview bug the brief flags) — this is the
paradigm PARTIAL/UNGUARDED case for this change.

### `server/lib/playbook/*` cross-cutting: registry/consistency

`PRACTICES` (`practices.js:24-80`) is this surface's canonical registry —
two entries, `session-token-ceiling` (session scope) and
`account-weekly-balance` (global scope). See §3.

## 2. Coverage verdict per surface

| Surface | Verdict | Why |
|---|---|---|
| `resolvePracticeConfig()` numeric `config`/`enabled` merge | GUARDED | Directly exercised via 6+ engine/route tests (threshold overrides, disabled gate) at both scopes. |
| `resolvePracticeConfig()` widened to `kindOverride`/`severityOverride`/resolved `kind`/`severity` (the change itself) | UNGUARDED | Field doesn't exist pre-change; zero tests reference `kind`/`severity` anywhere in `playbook.test.js` today (grep confirms 0 matches) to build from or regress against. |
| `evaluateSession()` writing `kind`/`severity` onto `coach_observations` | UNGUARDED | Engine tests assert `practice_id`/`scope_type`/`scope_id`/`status`/`values_json` but never `created[0].kind` / `.severity` — a swap, a stale bare read post-override, or a typo'd literal would not fail any current test. |
| `evaluateGlobal()` writing `kind`/`severity` | UNGUARDED | Same gap, independently, at the second call site — per §9.4 FIX-ROUND-REGRESSION and the brief's own "both engine call sites move together" invariant, this needs its *own* assertion, not one shared with `evaluateSession`'s. |
| `serializePractice()`'s `kind`/`defaultSeverity` (and future `resolvedKind`/`resolvedSeverity`) fields | UNGUARDED | `GET /api/playbook/practices` test asserts `enabled`/`config`/`scope` only; never reads `.kind` or `.defaultSeverity` off the response body. |
| `validateConfigPatch()` (numeric-field gate) | GUARDED (for its current numeric-only shape) | 400-unknown-field and 400-below-min are both directly tested. Its *future* sibling `validateOverridePatch()` doesn't exist yet — no verdict possible pre-build. |
| `PUT` partial-patch discipline for a **future** `kindOverride`/`severityOverride` key (must not clear on an unrelated numeric-only save) | UNGUARDED | No such key exists yet; the existing PUT tests only ever patch `config`/`enabled` together or `config` alone, so there's no precedent test proving `in`-based vs `=== undefined`-based key handling either way. |
| `coach_observations.kind` CHECK constraint | GUARDED by construction, not by direct test | Constraint exists in schema (`db.js:1372`); every current write path only ever passes catalog-fixed values, so it can't presently be violated, but no test inserts an out-of-range value and expects a SQLite failure. |
| `coach_observations.severity` CHECK constraint (the change's DDL) | UNGUARDED (does not exist) | `severity` is `TEXT NOT NULL`, no CHECK at all today (`db.js:1373`) — this is new work, and see §3 for why `db-migration.test.js`'s meta-test will not auto-catch it. |
| `PlaybookPage.tsx` live-preview kind wiring (lines 257, 335) | UNGUARDED | Both lines are read by the existing test file's rendering flow (preview text renders) but the *kind* value flowing into `<ObservationCard>` is never asserted — a hardcoded bare `practice.kind` would pass every existing assertion identically to a correctly-resolved draft kind. |
| `playbookStore.save()` numeric-only patch shape | GUARDED (current shape only) | Exercised via the two "saves an enabled/threshold change..." tests (128, 174), asserting the exact patch object passed to `api.playbook.updatePracticeConfig`. Will need new assertions once `kindOverride`/`severityOverride` are added to the patch shape. |
| Frozen-snapshot invariant (an Observation's `kind`/`severity` never retroactively changes) | UNGUARDED | No test in the repo writes an Observation, changes a config/override, and re-reads the Observation to assert it didn't change — because there is no override to change yet. This is the change's own load-bearing acceptance test and does not exist in any form today. |
| Single-resolver structural guard (`playbook-resolver-guard.test.js`) | UNGUARDED (file does not exist) | Confirmed via `ls server/__tests__/` — no file by this name or an equivalent scan over `practice.kind`/`practice.defaultSeverity` exists. See §3 for the precedent this should be modeled on. |

## 3. Registry/consistency gap check

**Canonical registry:** `PRACTICES` in `server/lib/playbook/practices.js`
(2 entries: `session-token-ceiling`, `account-weekly-balance`), consumed by
4 independent hand-written call sites per `PROJECT-CONTEXT.md` §9.1's
design-time pre-flag for this exact intake (dated 2026-08-02, "constant
becomes a variable" form):

1. `engine.js` `evaluateSession()` — lines 97-98
2. `engine.js` `evaluateGlobal()` — lines 145-146
3. `routes/playbook.js` `serializePractice()` — lines 40-41
4. `PlaybookPage.tsx` — two preview call sites, lines 257 and 335

Confirmed by direct grep (`grep -rn "practice\.kind\|practice\.defaultSeverity"`,
excluding `__tests__`): exactly these 6 read sites exist server-wide (4) and
client-wide (2), matching the catalog's own count exactly. **None of the 4
locations has an assertion tying its output back to the `PRACTICES` catalog
entry for `kind`/`defaultSeverity`** — every existing test either doesn't
read the field (engine, route-GET) or reads it only as static fixture setup
(client test). This is precisely the §9.1 DERIVED-DUAL-VIEW entry the
project's own defect catalog names for this intake: the 4 sites "agree only
because the value cannot vary." Per this skill's mandate, this is called out
explicitly as **UNGUARDED**, independent of the fact that the whole suite is
currently green — a green suite here proves nothing about whether the 4
readers would agree if the value could vary, which is exactly what this
build makes true for the first time.

**Structural-guard precedent:** `server/__tests__/single-writer-guard.test.js`
("§9.1 DERIVED-DUAL-VIEW" guard for `plan-writeback.js`'s single-composer
write path) is the live precedent the brief's planned
`playbook-resolver-guard.test.js` should be modeled on. Its shape:
- Recursive file-scan helper (`scanFiles`) over `server/` excluding
  `__tests__`/`node_modules`/`dist`, matching a name/call-pattern regex.
- Asserts the *set* of production files containing the pattern is exactly
  the expected set (e.g. `["db.js", "plan-ingest.js"]` for `upsertPlanItem`),
  not just "at least the expected files."
- A second, sharper assertion for the one caller-side function
  (`appendPlanItem`/`appendSubItem` must be lexically nested inside
  `applyDisposition`'s function body specifically, counted by brace-depth
  scanning) — directly analogous to the brief's "nowhere in `engine.js`
  specifically (separate, sharper assertion)" requirement.
- A `__testonly` production-code-reference guard as a second, independent
  structural check in the same file.

`server/__tests__/chronology-ordering.test.js` is the second, complementary
precedent (not asked for directly but relevant to "how this project already
proves a guard is non-vacuous"): it keeps a dated `GRANDFATHERED_QUERIES`
allow-list alongside its static SQL-shape scan, and its own build-outcome
history (`PROJECT-CONTEXT.md` §9.2) documents a real instance of a
too-permissive regex silently under-scanning — worth citing to whoever
writes `playbook-resolver-guard.test.js`'s scan pattern as a reason to keep
the pattern strict (e.g. matching `practice\.kind` and `practice\.
defaultSeverity` as whole-token regexes, not a looser substring match that
could silently pass through a renamed variable).

Neither guard file currently references `practices.js`, `engine.js`,
`routes/playbook.js`, or `PlaybookPage.tsx` in any capacity — confirmed by
reading both files in full. `playbook-resolver-guard.test.js` does not
exist (`ls server/__tests__/`), consistent with the brief.

**Defect-catalog id for this gap:** `PROJECT-CONTEXT.md` §9.1
DERIVED-DUAL-VIEW, design-time pre-flag dated 2026-08-02 for this exact
intake (6th touch on the pattern, not yet counted as an occurrence — count
increments only if a real duplication ships). The same file also flags a
**second**, narrower §9.1 instance already live on this exact surface today
(not introduced by this change): `resolvePracticeConfig()`'s numeric-field
rule and `validateConfigPatch()`'s copy of the same rule are two independent
functions that both walk `practice.fields` and never call each other — see
the brief's own "Two-independent-validators hazard" test-invariant and the
catalog's "second-order form" note. Existing coverage for *this* narrower
instance: `playbook.test.js`'s 400-unknown-field/400-below-min tests
(340-354) exercise `validateConfigPatch()`'s copy only; nothing in the suite
exercises `resolvePracticeConfig()`'s copy for the *same* invalid-input
cases (e.g. does a stored non-numeric or below-min value in the DB get
silently dropped by the resolver the way the route pre-emptively rejects
it at the door?) — PARTIAL, not GUARDED, for that instance.

## 4. Current baseline (run it)

Ran the targeted suites for every touched surface rather than the full
`npm test` (per this skill's "don't run the whole world" guidance); no
service dependency issues encountered (SQLite is file-based/in-process here,
no external DB server to be down).

**Server** — `node --test server/__tests__/playbook.test.js
server/__tests__/db-migration.test.js server/__tests__/single-writer-guard.test.js`

```
# tests 38
# suites 11
# pass 38
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 312.426792
```

All 38 GREEN — 20 in `playbook.test.js` (engine + routes), the full
`db-migration.test.js` file (existing `UPGRADE_CASES` + the
`ALTER TABLE`-only meta-test), and all 5 in `single-writer-guard.test.js`
(the precedent guard, run to confirm it is itself currently green/uninvolved
with this surface).

**Client** — `cd client && npx vitest run src/pages/__tests__/PlaybookPage.test.tsx`

```
 ✓ src/pages/__tests__/PlaybookPage.test.tsx (10 tests) 327ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

All 10 GREEN.

**Baseline: fully GREEN, 48/48, on the current tree at HEAD (`f78b2ec`)** —
consistent with the change brief's own claim that nothing has landed on
this surface since the technical plan was authored today. This confirms the
pre-build starting point the acceptance criteria (`§9.3 VACUOUS-GUARD`
"shown red before counting") will need to diff against: every kind/severity
assertion the build round adds must be provably absent-or-failing against
*this exact* green baseline before it counts as a real regression guard.

Not run: full `npm test` (server+client, ~70+ server spec files plus the
full client suite) — out of scope for a targeted coverage baseline and
unnecessary here since none of those other files reference
`server/lib/playbook/`, `coach_observations`, `playbook_practice_config`,
or `PlaybookPage.tsx`/`playbookStore.ts` (confirmed via the change brief's
own "nothing else touches this surface" grep pass, independently spot-
checked with `grep -rl "playbook\|coach_observations" server/__tests__
client/src --include=*.test.* --include=*.test.tsx` returning only the four
files already covered above). `npm run test:mcp` / `desktop:test` were not
run — no MCP or desktop surface is touched by this change.

## 5. Conventions in play (where new tests belong)

- **Server engine/route tests** — extend
  `server/__tests__/playbook.test.js` in place (the brief's own plan: this
  file is explicitly named as gaining the frozen-snapshot regression +
  override route cases, not a new file). Follow the file's existing
  per-`describe` grouping: engine cases under `describe("playbook engine")`
  seeded via `seedSession`/`seedTokens`/`seedAccount` helpers already
  defined at the top of that block; route cases under
  `describe("playbook + coach routes")` using the existing
  `get`/`put`/`post` HTTP helpers against the real temp-file SQLite + real
  Express app.
- **Migration tests** — extend `server/__tests__/db-migration.test.js`'s
  `UPGRADE_CASES` array (one entry per legacy-shape test, following the
  existing entries' `{ table, column, legacySql, ... }` shape used for
  `ALTER TABLE`-style migrations) *plus* a hand-written non-`UPGRADE_CASES`
  test for the rebuild path specifically, since the file's own meta-test
  (714-746) only scans `ALTER TABLE … ADD COLUMN` and structurally cannot
  represent a rename→recreate→copy→drop rebuild — confirmed by reading the
  regex (`/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/g`) at line 720,
  which has no path for `CREATE TABLE … RENAME`/`INSERT INTO … SELECT`
  patterns at all. This is exactly why the technical plan calls this
  migration test a *required deliverable*, not something the existing
  meta-test would catch for free — confirmed correct by this pass.
- **Structural guard** — new file
  `server/__tests__/playbook-resolver-guard.test.js`, modeled on
  `single-writer-guard.test.js`'s `scanFiles()` recursive-scan +
  exact-file-set-assertion shape (see §3). Naming convention:
  `<what-it-guards>-guard.test.js`, matching `single-writer-guard.test.js`
  and the `awaiting-subagent-guard.test.js` file already in the same
  directory.
- **Client UI tests** — extend
  `client/src/pages/__tests__/PlaybookPage.test.tsx` in place (again, the
  brief names this exact file, not a new one). Follow the existing
  `vi.mock("../../lib/api", ...)` + `playbookStore.__resetForTest()` +
  `renderPage()` harness already established there; new selector-rendering/
  live-preview/save-payload cases should sit in the same `describe
  ("PlaybookPage")` block, grouped near each card's existing tests
  (session-token-ceiling cases before line 148, account-weekly-balance
  cases after).
