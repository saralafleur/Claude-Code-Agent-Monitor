# E2E / API-Contract Test Plan — practice-kind-override

> Authored by `qa-e2e-architect`. Designs the thin, wired-up-flow layer over
> the frozen-snapshot unit/engine tests `technical-plan.md` §6.1/§6.2 already
> directs. Two flows only — the API-round-trip-through-a-live-tick the
> orchestrator brief named explicitly, and the boot-sequence/migration proof
> — plus the isolation/broadcast checks that ride along almost for free. See
> "Cost note" at the end for the explicit hand-off boundary to the unit layer.

## 0. Tooling grounding (confirmed against live code, not assumed)

This repo has **no separate e2e framework** — no Cypress, no Playwright, no
tagged smoke/regression suites, no bucket config file. Confirmed:

- `package.json`: `"test:server": "node --test server/__tests__/*.test.js"` —
  a single flat glob over `node:test` spec files. No `test:e2e` script, no
  `--grep`/tag convention, nothing in `PROJECT-CONTEXT.md` either (grep for
  `e2e`/`playwright`/`bucket`/`tag` turns up only prose references to *this
  doc's own name* from other intakes, e.g.
  `intake/2026-08-01-build-project-manager/`).
- `server/__tests__/playbook.test.js` (the file this change already lands
  most of its tests in, per the technical plan) has two established shapes in
  one file:
  - **Engine-direct shape** (`describe("playbook engine")`): unique
    `DASHBOARD_DB_PATH` per test via `beforeEach`/`afterEach`, `require("../db")`
    + `require("../lib/playbook/engine")` fresh each time, calls
    `engine.tick(dbModule)` directly — no HTTP, no Express.
  - **Real-server shape** (`describe("playbook + coach routes")`): one
    `DASHBOARD_DB_PATH` for the whole describe block, `createApp()` +
    `startServer(app, 0)` (OS-assigned port) from `../index`, driven with a
    hand-rolled `http.request` `fetchJson()` helper (no supertest). Cleans up
    the DB file + `-wal`/`-shm` and closes the server in `after()`.
- `server/__tests__/agents-legacy-rebuild.test.js` — the precedent for
  exactly this change's Step 2 shape: a **table rebuild triggered by a stale
  CHECK constraint**, not a plain `ALTER TABLE … ADD COLUMN`. It hand-builds
  a legacy DB with raw `better-sqlite3` (no fixture file — none exists
  anywhere in this repo; every "legacy DB" in the suite is synthesized
  in-test), points `DASHBOARD_DB_PATH` at it, then asserts
  `assert.doesNotThrow(() => require("../db"))` as its first, load-bearing
  check — i.e., "the app doesn't crash on startup for an existing install"
  **is already this project's own idiom** for a boot-sequence proof, not
  something to invent.
- `server/__tests__/db-migration.test.js` — the `UPGRADE_CASES` array/meta-
  test harness is shaped specifically for `ALTER TABLE … ADD COLUMN` cases
  (`legacySql` + `seed` + `assertLegacyRow` + `assertWritable`, scanned by a
  regex meta-test). The `coach_observations` severity `CHECK` is a full
  rename-recreate-copy-drop rebuild, structurally the same shape as
  `agents-legacy-rebuild.test.js`'s subject, **not** the `UPGRADE_CASES`
  shape — that harness's own meta-test only scans `ALTER TABLE … ADD COLUMN`
  and would not recognize this case either way (confirmed in the change
  brief's own note on this exact point).
- `server/__tests__/plans-api.test.js` — the broadcast-verification idiom:
  this project's route tests never attach a real WebSocket client to assert
  on a `broadcast(...)` call; they verify indirectly ("if the broadcast
  worked, a subsequent GET reflects it" — see its `"broadcasts the existing
  plan_updated type"` test, and its own comment saying so explicitly). No new
  pattern needed here.

**Conclusion for "bucket"/"tag":** this project's only bucketing unit is *the
spec file itself* (`node --test server/__tests__/*.test.js`), and isolation
(unique `DASHBOARD_DB_PATH` per file, or per-test via `beforeEach` inside one
file) is what makes tests parallel-safe by construction — not a serial/tag
flag. No tagging mechanism should be invented for this effort. "Bucket" below
means "which spec file, and which existing `describe` block or a new one."

---

## 1. Flows to cover

Two flows, matching the two things named explicitly in this task plus the
one isolation/regression check that rides along with the first almost for
free:

1. **Override round-trip through a live engine tick, via the real HTTP API.**
   `PUT /api/playbook/practices/:id/config` with a `kindOverride`/
   `severityOverride` → call the real `engine.tick(dbModule)` against the
   same live DB the server is using (the "trigger the Coach engine tick"
   step named in this task) → `GET /api/coach/observations` → confirm the
   newly-fired Observation carries the overridden `kind`/`severity`, **while
   a pre-existing Observation from a different, non-overridden practice,
   fetched through the same list endpoint, is unchanged** (isolation — DEC-2
   generic-mechanism proof, done via a real fired row rather than only two
   `GET /practices` catalog entries). Then flip the override again and
   confirm the *first* Observation's `kind`/`severity` — already frozen at
   fire time — still reads its original values through the same `GET`, i.e.
   the live-HTTP shape of the frozen-snapshot invariant, not just the
   direct-`stmts` shape the engine-level test (§6.1 of the technical plan)
   already covers.
2. **Full boot sequence against a synthesized pre-migration DB.** Hand-build
   a legacy `coach_observations` table (current shape: `severity TEXT NOT
   NULL`, no `CHECK`) with rows carrying both `'info'` and `'warning'`,
   point a fresh process at it, and prove: `require("../db")` does not
   throw; the rebuild ran and is idempotent on a second boot; both indexes
   exist; every pre-existing row is byte-identical; a `CHECK` violation now
   rejects `'critical'`; and — going one step further than the pure `db.js`
   proof — the **real Express server actually boots against that migrated
   DB** and a live `GET /api/coach/observations` returns the pre-existing
   rows with their original `kind`/`severity` intact. Plus the WATCH-3
   skip-path twin: an install with an out-of-enum `severity` value already
   present boots without throwing and without rewriting that row.

Both flows are deliberately thin — one happy path each, proving the wiring
between layers actually exists, not the full permutation matrix (see §6).

---

## 2. Spec files

| # | Spec file | New/extend | Bucket rationale |
|---|---|---|---|
| 1 | `server/__tests__/playbook.test.js` | **extend** — new `describe("playbook override — API round trip through a live engine tick")` block, sibling of the existing `describe("playbook + coach routes")` | Same file the technical plan already directs the frozen-snapshot and route-level tests into (§6.1/§6.2); this is the file's established home for both engine-direct and real-HTTP-server access to this exact surface. Kept as its **own describe block**, not folded into the existing `"playbook + coach routes"` block, because that block deliberately sets `DASHBOARD_PLAYBOOK_MODE=off` "so it doesn't race the real scheduler" and never requires `engine.js` — this new block needs to `require("../lib/playbook/engine")` in the same process as the live server so `engine.tick(dbModule)` and the HTTP layer share one DB, which is a different setup shape worth its own `before`/`after`. |
| 2 | `server/__tests__/db-migration.test.js` | **extend** — new top-level `describe("Migration: coach_observations severity CHECK rebuild")` block, **not** an `UPGRADE_CASES` entry | This is the file `technical-plan.md` §6.4 explicitly names for "the new severity-CHECK rebuild case." Flagging for the build reviewer: structurally this is a rebuild-triggered-by-a-stale-CHECK case, the same shape `agents-legacy-rebuild.test.js` already owns as its own dedicated file — that precedent exists specifically because this shape (hand-built raw legacy DB, `assert.doesNotThrow(() => require("../db"))`, index/row-preservation asserts) doesn't fit `db-migration.test.js`'s `UPGRADE_CASES`/`legacySql`/`seed`/`assertLegacyRow` harness, which is built for plain `ALTER TABLE … ADD COLUMN`. Either location is mechanically fine (same `*.test.js` glob, same meta-test either way ignores this case), but if the build wants to match precedent for shape rather than literal file name, `server/__tests__/coach-observations-severity-rebuild.test.js` (mirroring `agents-legacy-rebuild.test.js` file-for-file) is the better-fitting alternative — call this out in the PR description rather than silently deciding either way. Do **not** add anything to `UPGRADE_CASES` or `GRANDFATHERED` for this. |

No spec needs a serial bucket: file 1's new block uses its own
`DASHBOARD_DB_PATH`/port inside its own `before`/`after` (isolated from the
other two blocks already in that file); file 2's new block follows the exact
per-`describe` isolation (`tempDbPath` unique per `Date.now()`) every other
migration block in that file already uses. `node --test`'s default parallel
file execution, and parallel `describe` blocks within one file, are both
already safe here.

---

## 3. Tag

None — this project has no smoke/regression/serial tag mechanism (see §0).
Both additions are picked up automatically the moment they exist, by
`test:server`'s `server/__tests__/*.test.js` glob; no registration step.

---

## 4. Assertions

### 4.1 `playbook.test.js` — new `describe` block, the round-trip

Setup (`before`, once): unique `DASHBOARD_DB_PATH`,
`DASHBOARD_PLAYBOOK_MODE=off` (mirrors the existing routes block — no real
scheduler racing a manually-driven tick), `createApp()` + `startServer(app,
0)`, plus `require("../lib/playbook/engine")` and `require("../db")` in the
same process (no `require.cache` clearing here — the point is that the HTTP
layer and the manually-driven `engine.tick(dbModule)` share one live DB).
Seed one account-weekly-balance-firing pair of accounts (`acct-a` 80%,
`acct-b` 40%) and tick once *before* any override is set, so a pre-existing,
non-overridden `account-weekly-balance` Observation exists on the DB before
the scenario under test begins.

- **`PUT /api/playbook/practices/session-token-ceiling/config` with
  `{ kindOverride: "risk", severityOverride: "warning" }`** → `200`; response
  body shows `kindOverride: "risk"`, `severityOverride: "warning"`,
  `resolvedKind: "risk"`, `resolvedSeverity: "warning"` (catalog `kind`
  still reads `"info"`/whatever the catalog default is — assert the two
  fields are visibly different in the response, proving `resolvedKind` isn't
  just echoing the catalog value).
- Seed a session and tokens that cross `session-token-ceiling`'s threshold,
  then call `engine.tick(dbModule)` directly (the "trigger the Coach engine
  tick" step) — assert it returns exactly one new observation for
  `session-token-ceiling`.
- **`GET /api/coach/observations`** → the newly-fired row's `kind` is
  `"risk"` and `severity` is `"warning"` (the override, frozen at fire time)
  — **and** the pre-existing `account-weekly-balance` row seeded in `before`
  still shows its original catalog `kind`/`severity`, unchanged by the fact
  that a *different* practice now has an override (DEC-2 isolation, proven
  through the one list endpoint an operator actually uses, not just two
  catalog entries).
- **Change the override again** (`PUT { kindOverride: "good",
  severityOverride: "info" }`), tick again is *not* required for this
  assertion — re-fetch the **already-created** session-token-ceiling
  Observation by id via `GET /api/coach/observations` (or
  `dbModule.stmts.getCoachObservation.get(id)` if the list endpoint doesn't
  expose direct-by-id lookup) and assert its `kind`/`severity` are still
  `"risk"`/`"warning"`, byte-unchanged — the live-HTTP-visible shape of the
  frozen-snapshot invariant. Explicitly do **not** assert this row's
  `kind`/`severity` equal the practice's *new* `resolvedKind`/
  `resolvedSeverity` — per the technical plan §2.4/§5, that equality is the
  wrong criterion here and asserting it would demand a re-sync mechanism the
  plan explicitly forbids.
- **No unresolved placeholder reaches the response:** every `kind`/
  `severity` value returned by `GET /api/coach/observations` and `GET
  /api/playbook/practices` is one of the pinned enum values
  (`risk|info|good` / `info|warning`) — never `null`, `undefined`, or a raw
  i18n key string leaking through (the client is the only i18n owner; the
  API must never emit an unresolved key).
- **Broadcast, tested indirectly** (this project's own idiom, per
  `plans-api.test.js`): after the `PUT`, a follow-up `GET
  /api/playbook/practices` reflects the new override — proving the
  server-shared write actually persisted and is visible to a second "client"
  read, which is what the `playbook_practice_config_updated` broadcast exists
  to keep true across connected clients. No real WebSocket client is
  attached, matching this repo's existing convention.

### 4.2 `db-migration.test.js` (or its own file, per §2) — the boot proof

Mirrors `agents-legacy-rebuild.test.js`'s shape file-for-file. `before()`:
hand-build, with raw `better-sqlite3`, a `coach_observations` table using the
**current** (pre-CHECK) body — `severity TEXT NOT NULL`, no `CHECK` — with
rows covering both `'info'` and `'warning'`; close the raw handle; point
`DASHBOARD_DB_PATH` at that file.

1. **`assert.doesNotThrow(() => require("../db"))`** — the load-bearing
   "doesn't crash on startup for an existing install" check, this project's
   own established phrasing for it.
2. `sqlite_master.sql` for `coach_observations` now contains
   `CHECK(severity IN` (schema actually changed, not silently no-op'd).
3. Every pre-existing row is byte-identical across every column, same `id`s,
   same order — `SELECT * FROM coach_observations ORDER BY id` before/after,
   deep-equal.
4. Both `idx_coach_observations_open` and `idx_coach_observations_detected_at`
   exist (`SELECT name FROM sqlite_master WHERE type='index'`).
5. Inserting `severity = 'critical'` via `stmts.insertCoachObservation.run`
   now throws/fails (the `CHECK` is real, not declared-only).
6. **Idempotency:** `delete require.cache[...]; require("../db")` a second
   time against the same file is a clean no-op — `sqlite_master.sql` guard
   text prevents a second rebuild; row count and values unchanged.
7. **WATCH-3 skip path, twin `before`:** a *second* legacy DB seeded with one
   out-of-enum `severity` value (e.g. `'critical'`) present alongside valid
   rows → `require("../db")` does not throw, `sqlite_master.sql` still shows
   **no** `CHECK` (the rebuild skipped, exactly as designed), and the
   offending row's `severity` value is untouched (not rewritten to force
   compliance — rewriting a historical row would itself violate the frozen-
   snapshot invariant this whole build protects).
8. **The one extra layer beyond `agents-legacy-rebuild.test.js`'s own bar:**
   after `require("../db")` succeeds against the first (clean-rebuild) legacy
   DB, also `createApp()` + `startServer(app, 0)` and hit a real `GET
   /api/coach/observations` — assert `200` and that the pre-existing legacy
   rows come back with their original `kind`/`severity` values, proving the
   **whole server**, not just `db.js`'s `require`-time migration block,
   survives an upgrade boot against a real pre-migration DB.

---

## 5. How to run a single spec

No base URL, no external stack, no environment bring-up — every spec in this
suite is self-contained: it sets its own `DASHBOARD_DB_PATH` to a fresh temp
SQLite file (or hand-built legacy file), starts its own Express app on an
OS-assigned port when it needs HTTP, and cleans up in `after()`. This is the
project's actual convention (confirmed against `playbook.test.js`,
`agents-legacy-rebuild.test.js`) — there is no shared dev server or
"stack must be up" prerequisite.

```bash
# Run the extended playbook spec (engine + routes + new round-trip block):
node --test server/__tests__/playbook.test.js

# Narrow to just the new round-trip block while iterating:
node --test --test-name-pattern="API round trip through a live engine tick" \
  server/__tests__/playbook.test.js

# Run the migration/boot-sequence spec:
node --test server/__tests__/db-migration.test.js
# — or, if landed as its own file per §2's precedent note:
node --test server/__tests__/coach-observations-severity-rebuild.test.js

# Everything this effort touches (the required gate before merge):
npm run test:server
npm test   # server + client, matches the technical plan's DoD
```

---

## 6. Cost note — what this layer does and does not prove

E2E-shaped tests here (a real temp/synthesized SQLite file, a real Express
server on an OS-assigned port) are expensive relative to pure unit/engine
tests, so this plan is deliberately the **minimum** that proves the two
things named in this task — the live-HTTP-round-trip shape of the
frozen-snapshot invariant, and a real server boot against a real
pre-migration DB — not the full permutation matrix.

**Covered here, once each, at the seam that actually matters:**
- One `PUT` → real `engine.tick` → `GET` round trip, proving the override
  actually flows from the wire, through storage, through the resolver, into
  a fired Observation, and back out an HTTP response — and that a
  *different* practice's Observation is untouched by it.
- One re-fetch of an already-fired Observation after the override changes
  again, proving the frozen-snapshot invariant holds through the real HTTP
  read path, not just via direct `stmts` access.
- One clean-rebuild boot, one idempotent-second-boot, one WATCH-3 skip-path
  boot — each exactly once, each against a synthesized (not fixture-file)
  legacy DB, matching this repo's own established idiom for "legacy DB" in
  every existing migration test.

**Deliberately left to the unit/engine layer (do not duplicate here):**
- The full frozen-snapshot regression **for both scopes** (session *and*
  global), asserting `kind`/`severity` at every step including the
  `updateCoachObservationStatus`-dismiss-and-refire cycle, and proven red
  against pre-change code first (§9.3 VACUOUS-GUARD) — `technical-plan.md`
  §6.1's own worked test in `describe("playbook engine")`, using direct
  `stmts`/`dbModule` access. This e2e layer's round-trip test exercises only
  the session scope through HTTP; it does not re-run the global-scope twin
  through HTTP too, since the engine-level test already proves both scopes
  move together at the call-site level (§9.4), and a second HTTP-level
  repetition of the same fact buys no additional confidence for the cost of
  a second real server boot.
- Every route-level validation branch (`400` on an invalid `kindOverride`/
  `severityOverride`, `404` on an unknown practice, the numeric-PUT-does-
  not-clear-an-override regression, clear-to-`null`) — `technical-plan.md`
  §6.2's dense route-test list in `playbook.test.js`'s existing `describe("PUT
  /api/playbook/practices/:id/config")` block is the correct and sufficient
  owner; this layer's job is proving the happy-path wiring exists, not
  re-sweeping every 400.
- The structural single-resolver guard (`playbook-resolver-guard.test.js`)
  and its required red-then-green proof (§9.3) — a static analysis test, not
  a flow, with no server or DB involved; nothing for this layer to add.
- The five other `db-migration.test.js` `UPGRADE_CASES` migrations already in
  the suite — untouched by this change, not re-verified here.
- Any client-rendering assertion — **out of scope for this layer entirely**.
  In particular, the live-preview-updates-before-save regression (Engineer
  §5.3 / `PlaybookPage.tsx` lines 257/335) is invisible to every test in this
  document: no HTTP request or DB row can observe what a React component
  renders before a save. That is `client/src/pages/__tests__/
  PlaybookPage.test.tsx`'s job (Vitest + Testing Library), owned by the unit
  layer, and is the *only* place this specific regression can be caught.
- i18n completeness across all four locales for the new `severityLabel`/
  `playbook.*` keys — a static file-presence check, not a flow; no server
  round-trip needed to prove a JSON file has four keys in four files.
- The manual double-boot walkthrough against a copy of Sara's *real*
  production DB (`technical-plan.md` §6.6) — this document's migration spec
  proves the mechanism against a synthesized legacy DB, which is necessary
  but not sufficient; the plan's own DoD still requires the one-time manual
  walkthrough against the real file before merge, and no automated spec here
  substitutes for that.
