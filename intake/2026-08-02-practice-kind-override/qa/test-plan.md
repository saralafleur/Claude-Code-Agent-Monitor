# Test Plan — practice-kind-override

> Authored by `qa-lead`, reconciling `supporting/coverage.md`, `supporting/risk.md`,
> `supporting/unit-tests.md`, `supporting/e2e-tests.md` and the strategist's
> `qa-assessment.md` (verdict: **BLIND**). This is the buildable QA deliverable:
> exactly what to fix in the plan, exactly what specs to add, in what order, with
> what assertions. Execute it top to bottom — nothing here needs re-deriving from
> the supporting documents.
>
> **Read this first:** §0 contains three **must-fix-in-plan** items. They are code
> changes to `server/db.js`, not tests, and they **gate everything below**. Do not
> start writing tests until F1 and F2 have landed — T1 is written specifically to
> prove F1 shipped, and against the plan as currently written it cannot pass.

---

## Objective

This change makes a value that has never varied (a Playbook practice's effective
`kind`/`severity`) vary for the first time, across four hand-written readers, and
rebuilds a table that holds real user history in order to do it. Today **zero
tests in the repo read `kind` or `severity` on this surface** — the suite is 48/48
green and would stay 48/48 green if the engine wrote the wrong kind, if the route
dropped the override, or if the preview card kept rendering the stale catalog
value. This plan adds 8 gating test groups across four layers so that, at the end,
these invariants are mechanically guarded and are not today: (1) an interrupted
`coach_observations` rebuild cannot silently orphan every historical Observation;
(2) an Observation's `kind`/`severity` is frozen at fire time and never
retroactively relabelled — proven at **both** engine call sites, not one; (3) an
override that is saved is actually applied by every read path, and is not eaten by
an unrelated numeric save; (4) exactly one resolver produces effective
kind/severity server-side, enforced structurally; (5) the deliberately-duplicated
client draft resolver produces **byte-identical** results to the server resolver
over one shared case table; and (6) the live preview reflects the draft override
before save, on both cards.

---

## Coverage gap being closed

Each row is an UNGUARDED surface from `qa-assessment.md`, its defect-catalog id in
`PROJECT-CONTEXT.md` §9, and the assertion that will pin it.

| # | UNGUARDED surface | Catalog id | Assertion that pins it |
|---|---|---|---|
| 1 | `coach_observations` rebuild crash window — a half-run migration is indistinguishable from a finished one; every Observation orphaned in `_old`, app boots clean | **§9.6 NON-ATOMIC REBUILD** (new entry, 5 latent live instances) | **T1**: source-level assertion that the whole rebuild is one `BEGIN…COMMIT` in `server/db.js`, **plus** a behavioural interruption test proving an aborted rebuild rolls back to the pre-migration table with every row readable, **plus** an orphan-guard boot test |
| 2 | Frozen-snapshot invariant (the feature's entire point) — nothing writes an Observation, changes a config, and re-reads it | **§9.1 DERIVED-DUAL-VIEW, inverted form** | **T2**: 3-step fire → override → re-fire → override → re-fire cycle, re-reading every prior row via `stmts.getCoachObservation.get(id)`, asserting `kind` *and* `severity` unchanged at each step |
| 3 | Both engine call sites (`evaluateSession` / `evaluateGlobal`) are two independent `insertCoachObservation.run(...)` writers | **§9.4 FIX-ROUND-REGRESSION** | **T2** ships as two independent tests, one per scope, with provably-different override values; **T4b** asserts zero raw `practice.kind` reads remain in `engine.js` |
| 4 | Migration correctness on a real upgrade boot — CHECK present, rows byte-identical incl. `id`s, both indexes recreated, out-of-enum rejected, second boot a no-op, WATCH-3 skip path | **§9.5 FRESH-DB-BLIND** (variant the §9.5 meta-test structurally cannot see) | **T3**: 6 clean-path assertions + 3 skip-path assertions against hand-built legacy DBs, + one real-Express-boot proof |
| 5 | "Saved but never applied" — a PUT that 200s while every read path ignores the stored value | §9.1 (two-independent-validators) | **T5**: PUT 200 **and** a follow-up `GET /practices` showing `resolvedKind` actually changed |
| 6 | Numeric-only save silently clearing an existing override | §9.1 (partial-patch discipline) | **T6**: `PUT { config: { gapThresholdPct: 30 } }` leaves `kindOverride: "risk"` intact |
| 7 | Live-preview wiring at `PlaybookPage.tsx:257`/`:335` — invisible to every server-side test that will ever exist | §9.1 (client display path) | **T7**: selector change updates the rendered badge **before** any save, run against **both** card fixtures |
| 8 | Client draft resolver vs. server resolver disagreeing — a second, independent copy of the resolution rule shipped by design; the structural guard scans for raw `practice.kind` reads and **cannot see this** | **§9.1 second-order form** (the 2026-08-01 lesson, reproduced one day later on the same catalog entry) | **T8**: one shared JSON case table driven through **both** `resolvePracticeConfig()` (server, `node:test`) and `resolveDraftKind`/`resolveDraftSeverity` (client, Vitest), asserting identical results including the out-of-enum fail-safe |
| 9 | Structural single-resolver guard does not exist | §9.1 + **§9.3 VACUOUS-GUARD** | **T4**: 3 scan assertions (server-strict, engine-sharpest, client-display-path), each proven red by rogue-reader injection and recorded in the commit message |

---

## §0 — MUST-FIX-IN-PLAN (do these first; they gate every test below)

These are changes to `server/db.js`, not tests. `technical-plan.md` Step 2.2
models the `coach_observations` rebuild on this repo's **`plan_items`** precedent,
in which only the row copy is transaction-wrapped and the surrounding
`RENAME`/`CREATE`/`DROP` are separate autocommitted statements. That is the wrong
precedent. The repo's **`agents`** rebuild (`server/db.js:1478-1514`) is the only
one of six that is correct. Copy that one.

### F1 — Wrap the entire rebuild in one transaction (`agents` shape, create-new-then-rename)

Concretely, in `server/db.js`:

1. `PRAGMA foreign_keys = OFF` **outside and before** `BEGIN` — SQLite ignores the
   pragma inside a transaction; `agents` already gets this right.
2. One single `db.exec(...)` containing, in this order:
   `BEGIN;` → `CREATE TABLE coach_observations_new (…CHECK(severity IN ('info','warning'))…);`
   → `INSERT INTO coach_observations_new SELECT … FROM coach_observations;`
   → `DROP TABLE coach_observations;`
   → `ALTER TABLE coach_observations_new RENAME TO coach_observations;` → `COMMIT;`
3. Restore `PRAGMA foreign_keys = ON`, then recreate `idx_coach_observations_open`
   and `idx_coach_observations_detected_at`.

Use **create-new → copy → drop-old → rename**, not `plan_items`' rename-first
direction: on rollback the original table is still sitting there under its own
name, so even a torn WAL recovery lands on the pre-migration state.

Cost: ~5 lines. It removes the failure mode rather than documenting it.

### F2 — Orphan detection in the idempotency guard (cheap belt)

Gate the rebuild on `hasCheck && !orphanExists`, where

```sql
SELECT name FROM sqlite_master WHERE type='table'
  AND name IN ('coach_observations_old','coach_observations_new')
```

With F1 this should be unreachable — which is exactly why it is worth having: if
it ever fires, something the atomic wrap was supposed to prevent has happened.
**Log loudly and skip. Do not throw.** `db.js` runs at `require()` time against a
single shared `DB_PATH`; a throw bricks boot for the Express server, the MCP
server, the Electron app and the VS Code extension simultaneously — strictly worse
than the condition it reports.

### F3 — Keep the plan's manual DoD gate

Back up the real `dashboard.db` before the first boot of the new build, and do the
`technical-plan.md` §6.6 manual double-boot walkthrough against **a copy** of it.
F1 makes this much safer; it does not make it optional.

**If the build team declines F1**, this must land as an explicit WATCH row in
`decisions.md` naming the data-loss mechanism (per `risk.md` §8), and T1 becomes
a documentation-only test. The QA recommendation is unambiguous: do not decline it.

---

## Test change set

Grouped by this project's actual layers, discovered from `package.json` and the
existing `server/__tests__/` conventions: there is **no separate e2e framework** —
no Playwright, no Cypress, no tags, no buckets. The bucketing unit is the spec
file; the "e2e layer" is the real-Express-app-over-real-HTTP-against-a-temp-SQLite
`describe` block that already exists in `playbook.test.js`.

### Layer 1 — Data layer / migration (`node:test`)

**`server/__tests__/coach-observations-severity-rebuild.test.js` — NEW FILE**

> **Layer/file decision (deviation from `technical-plan.md` §6.4 — record it in the
> PR description).** The plan names `db-migration.test.js`. Land this in its **own
> file** instead, mirroring `agents-legacy-rebuild.test.js` file-for-file, because:
> (a) `db-migration.test.js`'s `UPGRADE_CASES` harness (`legacySql` + `seed` +
> `assertLegacyRow`) is built for `ALTER TABLE … ADD COLUMN` and cannot represent a
> rebuild; (b) the interruption test (T1b) needs raw multi-connection control that
> does not fit that harness at all; (c) `agents-legacy-rebuild.test.js` is the
> existing precedent for exactly this shape. Nothing is lost — `test:server`'s
> `server/__tests__/*.test.js` glob picks it up automatically. Do **not** add an
> `UPGRADE_CASES` or `GRANDFATHERED` entry for this migration.

- **T1a — atomicity, structural.** `describe("coach_observations rebuild is atomic (§9.6)")`
  - `it("the coach_observations rebuild's DDL lives inside a single BEGIN…COMMIT db.exec")` —
    read `server/db.js` as text; locate the `db.exec` template literal containing
    `CREATE TABLE coach_observations_new`; assert that same string also contains
    `INSERT INTO coach_observations_new`, `DROP TABLE coach_observations`,
    `RENAME TO coach_observations`, starts with `BEGIN` and ends with `COMMIT`.
    Failure message must name §9.6 and point at `server/db.js:1478` (`agents`) as
    the shape to copy.
  - `it("PRAGMA foreign_keys = OFF is issued outside the transaction")` — assert
    the `foreign_keys = OFF` statement does **not** appear inside that same
    `BEGIN…COMMIT` string.
- **T1b — atomicity, behavioural (interruption).**
  - `it("an interrupted rebuild rolls back: every original row is still readable through coach_observations")` —
    build a legacy DB with 3 rows; open it with `better-sqlite3` and `exec` the
    rebuild prefix **without** `COMMIT` (`BEGIN; CREATE TABLE …_new; INSERT INTO
    …_new SELECT …; DROP TABLE coach_observations;`); `close()` the handle with the
    transaction still open (this is what a crash does — SQLite rolls back on next
    open). Reopen and assert: `coach_observations` exists, all 3 rows readable with
    original `id`s, `sqlite_master.sql` has **no** `CHECK(severity IN`, and no
    `coach_observations_new` orphan. Then `require("../db")` and assert the
    migration runs to completion now, with all 3 rows preserved and the CHECK
    present.
  - **Neither T1a nor T1b alone is sufficient, and the plan is explicit about
    this:** T1a binds the *shipped* code to the atomic shape; T1b proves the atomic
    shape survives interruption. Ship both.
- **T1c — orphan guard (proves F2).**
  - `it("boots without throwing, and without destroying data, when an orphaned coach_observations_old exists alongside a CHECK-bearing table")` —
    seed a DB with a CHECK-bearing (already-migrated-looking) `coach_observations`
    **and** a populated `coach_observations_old`. `assert.doesNotThrow(() => require("../db"))`;
    assert `coach_observations_old` still exists with its rows intact (the guard
    skips and logs; it must not silently drop the orphan, which is the only copy of
    the data if F1 ever failed).
- **T3a — clean upgrade path.** `describe("Migration: coach_observations severity CHECK rebuild")`.
  Legacy fixture: hand-built with raw `better-sqlite3` (no `db.js` involved), the
  current pre-CHECK body (`severity TEXT NOT NULL`, no CHECK) + both indexes + 2
  rows with distinct `id`s, `practice_id`, `scope_type`/`scope_id`, `values_json`,
  `status` (one `open`/null `responded_at`, one `dismissed`/non-null
  `responded_at`), one `severity='info'` and one `severity='warning'`. Six `it`s:
  1. `assert.doesNotThrow(() => require("../db"))` against the legacy DB.
  2. `sqlite_master.sql` for `coach_observations` contains `CHECK(severity IN`.
  3. `SELECT * FROM coach_observations ORDER BY id` deep-equals the pre-migration
     snapshot — every column, every `id`, byte-identical.
  4. Both `idx_coach_observations_open` and `idx_coach_observations_detected_at`
     exist in `sqlite_master`.
  5. Inserting `severity='critical'` throws `/CHECK constraint failed|SQLITE_CONSTRAINT/`.
  6. A second `require("../db")` (after clearing `require.cache`) is a clean no-op:
     row count and values unchanged.
- **T3b — WATCH-3 pre-flight skip path.** `describe("… — pre-flight skip (WATCH-3)")`,
  its own independent legacy DB seeded with **exactly one** out-of-enum row
  (`severity='critical'`) among conforming rows — the count-of-exactly-1 fixture is
  required, per `risk.md` §4.2, to catch an off-by-one in the `COUNT(*)` guard.
  Three `it`s: does not throw at require time; `sqlite_master.sql` still shows
  **no** `CHECK` (skipped, not forced); the offending row's `severity` is still
  `'critical'` (never rewritten — rewriting a historical row would itself violate
  the frozen-snapshot invariant this build exists to protect).
- **T3c — real server boots against the migrated legacy DB (the only genuine
  e2e-layer addition here).** After T3a's `require("../db")` succeeds:
  `createApp()` + `startServer(app, 0)`, then a real
  `GET /api/coach/observations` → `200`, and the two pre-existing legacy rows come
  back with their original `kind`/`severity`. Proves the **whole server**, not just
  `db.js`'s require-time block, survives an upgrade boot.
- **T3d — registry-derived CHECK assertion (single-source-of-truth; see §Guardrail).**
  Parse the `CHECK(severity IN (…))` value list out of `sqlite_master.sql` and
  `assert.deepEqual` it against `SEVERITY_VALUES` exported from
  `server/lib/playbook/practices.js`. Same for `CHECK(kind IN (…))` vs
  `KIND_VALUES`. A hand-edited DDL enum that drifts from the exported registry
  fails here.

### Layer 2 — Engine / resolver (`node:test`)

**`server/__tests__/playbook.test.js` — EXTEND**, inside the existing
`describe("playbook engine")` block (line 18), placed after
`"respects a raised account-weekly-balance gap threshold override"` (line 204).
Reuses the block's existing `seedSession`/`seedTokens`/`seedAccount` helpers and
its `beforeEach`/`afterEach` fresh-temp-DB harness — **no new fixtures**.

- **T2a — global scope, `account-weekly-balance`.**
  `it("freezes kind/severity onto each Observation at fire time; a later override change never relabels an earlier row (account-weekly-balance, global scope)")`.
  Three steps, re-reading prior rows via `dbModule.stmts.getCoachObservation.get(id)`
  (never from the tick's return value):
  1. No override → `first.kind === "info"`, `first.severity === "info"` (catalog).
     Dismiss to allow refire.
  2. `upsertPlaybookPracticeConfig.run("account-weekly-balance", 1, JSON.stringify({ gapThresholdPct: 25, kindOverride: "risk", severityOverride: "warning" }))`
     → tick → `second.kind === "risk"`, `second.severity === "warning"`; re-read
     `first` → still `info`/`info`, `status === "dismissed"`, `responded_at` set.
  3. Override again to `good`/`info` → tick → `third.kind === "good"`; re-read
     **both** prior rows → still `info`/`info` and `risk`/`warning`.
  **Persisted key is `kindOverride` (a top-level sibling inside the config JSON
  blob), NOT a nested `config.kind`.** `supporting/qa.md` §3a's snippet is wrong
  on this point and is explicitly superseded by `technical-plan.md` Override 3 —
  do not copy it verbatim.
- **T2b — session scope, `session-token-ceiling`.** Same three-step shape, catalog
  values `risk`/`warning`, overrides chosen **provably different from catalog**
  (`good`/`info`) so a test that accidentally reads the catalog value cannot pass
  by coincidence. Final step clears the override entirely (no `kindOverride` key at
  all) and asserts the fire reverts to catalog while both prior rows stay frozen.
  **T2a and T2b are two independent tests, not one parameterised test** — §9.4:
  `evaluateSession()` and `evaluateGlobal()` are two independent
  `insertCoachObservation.run(...)` call sites and a green test on one proves
  nothing about the other. A single-scope version of this test does not satisfy T2.
- **T2c — status isolation.**
  `it("updateCoachObservationStatus never touches kind or severity")` — fire, call
  `updateCoachObservationStatus.run("acknowledged", id)`, re-read, assert `kind`
  and `severity` unchanged and `status === "acknowledged"`. Cheap and implied by
  T2a/T2b, but the brief names it as its own checklist item — give it its own
  named, greppable test.

### Layer 3 — API / route (`node:test`, real Express + real HTTP)

**`server/__tests__/playbook.test.js` — EXTEND**, inside the existing
`describe("PUT /api/playbook/practices/:id/config")` block (line 313), using the
file's existing `get`/`put` helpers against the real `createApp()` + `startServer()`
harness. No new fixtures.

- **T5 — "saved but never applied" (the load-bearing direction).**
  `it("persists a kind override end-to-end: PUT succeeds AND a follow-up GET shows resolvedKind actually changed")`.
  PUT `{ kindOverride: "risk" }` → `200`; body has `kindOverride === "risk"`,
  `resolvedKind === "risk"`, **and `kind === "info"`** (the catalog value must
  still report the built-in meaning — asserting the two fields visibly differ is
  what proves `resolvedKind` is not echoing the catalog). Then a **follow-up
  `GET /api/playbook/practices`** showing `resolvedKind === "risk"`. The GET is
  mandatory: the PUT response is `serializePractice()` too, so a route that
  echoes the request body back would pass a PUT-only check while
  `resolvePracticeConfig()` never runs. Restore with `{ kindOverride: null }`.
- **T6 — partial-patch discipline.**
  `it("a numeric-only config PUT does not clear an existing kind override")` — set
  `kindOverride: "risk"`, then PUT `{ config: { gapThresholdPct: 30 } }` → `200`,
  `kindOverride` still `"risk"`, `resolvedKind` still `"risk"`. This requires
  `in`-based key-presence checks, not `=== undefined`. Get it wrong and every
  ordinary threshold save silently eats the operator's override. Restore state at
  the end of the test.
- **T5b/T5c/T5d — supporting route cases** (same block, cheap, keep them):
  400 on invalid `kindOverride`; 400 on invalid `severityOverride` (use
  `"critical"` — proves the enum is pinned to exactly `info|warning`); clearing to
  `null` reverts `resolvedKind` to `kind`; overriding one practice leaves the other
  practice's `kindOverride === null` and `resolvedKind === kind`.
- **Must still be green, unedited:** the existing `"400s on an unknown config field"`
  (line 340) and `"400s on a below-min value"` cases — `validateConfigPatch()` is
  explicitly **not** modified (Override 1). Call this out in the PR description; do
  not add a redundant assertion for it.

**`server/__tests__/playbook.test.js` — EXTEND**, new sibling
`describe("playbook override — API round trip through a live engine tick")` block
(its own `before`/`after`, own `DASHBOARD_DB_PATH`, `DASHBOARD_PLAYBOOK_MODE=off`,
`createApp()` + `startServer(app, 0)`, and `require("../lib/playbook/engine")` in
the same process so HTTP and `engine.tick(dbModule)` share one live DB). Seed an
`account-weekly-balance`-firing account pair and tick **once before** any override
is set, so a pre-existing non-overridden Observation is on disk.

- **T5e — the one and only flow proof.** PUT `{ kindOverride, severityOverride }`
  on `session-token-ceiling` → seed a session over threshold → `engine.tick()` →
  `GET /api/coach/observations`. Assert: the newly-fired row carries the override;
  the pre-existing `account-weekly-balance` row is untouched (DEC-2 isolation,
  proven through the list endpoint an operator actually uses); then change the
  override again and re-fetch the **already-created** row — still byte-unchanged
  (the live-HTTP shape of the frozen-snapshot invariant). Inline spot-check: every
  `kind`/`severity` in the response is one of the pinned enum values — never
  `null`, `undefined`, or a raw i18n key. Broadcast is verified indirectly via the
  follow-up GET, matching `plans-api.test.js`'s established idiom — **do not attach
  a real WebSocket client**; that is not this repo's convention.

### Layer 4 — Structural guards (`node:test`, static source scan)

**`server/__tests__/playbook-resolver-guard.test.js` — NEW FILE**, modeled on
`single-writer-guard.test.js` (fs-walk + regex + exact-file-set assertion +
actionable failure message). One structural change to the precedent: parameterise
`scanFiles(dir, pattern, extensions = [".js"])` so the same walker can cover
`client/src`'s `.ts`/`.tsx` — extend it, do not write a second copy.
`describe("Single-resolver structural guard (§9.1 DERIVED-DUAL-VIEW, this practice's effective kind/severity)")`.

- **T4a — server, strict.** `it("practice.kind / practice.defaultSeverity are read raw only inside server/lib/playbook/practices.js")` —
  scan `server/` (excluding `__tests__`, `node_modules`, `dist`) with
  `/practice\.kind\b|practice\.defaultSeverity\b/`; `assert.deepEqual` the
  basename set to exactly `["practices.js"]`.
- **T4b — engine, sharpest.** `it("engine.js contains zero raw practice.kind / practice.defaultSeverity reads — both evaluateSession() and evaluateGlobal() must read the resolved value (§9.4)")` —
  match count on `engine.js` must be `0`, with a failure message naming both
  evaluators and §9.4.
- **T4c — client display path.** `it("client/src reads practice.kind / practice.defaultSeverity nowhere but types.ts's interface declaration")` —
  scan `client/src` for `.ts`/`.tsx`; basename set must equal exactly `["types.ts"]`.
  Failure message must say "a preview card is hardcoding the catalog value again
  instead of the resolved draft value."
- **Keep every regex whole-token** (`practice\.kind\b`), per §9.2's 2026-08-01
  lesson that a scanner which silently under-scans is worse than none.

**`server/__tests__/playbook-resolver-parity.test.js` — NEW FILE** (server half of T8)
**`client/src/lib/__tests__/playbookStore.test.ts` — NEW FILE** (client half of T8)
**`server/__tests__/fixtures/playbook-resolution-cases.json` — NEW FIXTURE**

- **T8 — client/server resolver precedence parity.** This is the invariant no
  other document names, and the structural guard **cannot** detect it: T4 scans for
  raw `practice.kind` reads, and both copies can be perfectly free of raw reads
  while producing different answers. This is §9.1's second-order form — the exact
  shape that burned this catalog on 2026-08-01 ("the guard caught the composer and
  missed the second-order duplicate one call frame away"), reproduced by design one
  day later on the same catalog entry.
  - **One shared case table**, checked in as JSON so both runtimes read the *same
    bytes*. A `.json` under `server/__tests__/fixtures/` is not picked up by
    `test:server`'s `server/__tests__/*.test.js` glob, so this is safe. Both halves
    read it with `fs.readFileSync` + `path.resolve(__dirname, …)` — **not** an
    `import`, to avoid Vite `server.fs.allow` issues from the client side.
  - Row shape: `{ name, catalogKind, kindOverride, draft, expected, serverApplicable }`.
    JSON cannot express `undefined`, so use the literal sentinel `"__UNSET__"` for
    "no draft yet"; both halves map it to `undefined` on read.
  - **Required cases** (mirror each for severity with `catalogSeverity`/`severityOverride`):

    | catalogKind | kindOverride | draft | expected | serverApplicable |
    |---|---|---|---|---|
    | `risk` | `null` | `__UNSET__` | `risk` | yes |
    | `risk` | `good` | `__UNSET__` | `good` | yes |
    | `risk` | `"bogus"` (out of enum) | `__UNSET__` | `risk` (fail-safe to catalog) | yes |
    | `risk` | `good` | `info` | `info` (draft wins) | no |
    | `risk` | `null` | `info` | `info` | no |
    | `risk` | `good` | `null` | `risk` (explicit draft-clear falls to catalog, **not** to the stored override) | no |
    | `risk` | `null` | `null` | `risk` | no |

  - **Server half** (`playbook-resolver-parity.test.js`): for every row with
    `serverApplicable: true`, build a `playbook_practice_config` row carrying that
    `kindOverride`, call `resolvePracticeConfig(row, practice)`, assert `.kind ===
    expected`. The out-of-enum row is the one that proves the resolver **coerces to
    the catalog default and never throws** — it runs outside `tick()`'s per-scope
    try/catch, so a throw there kills every practice's evaluation for that tick.
  - **Client half** (`playbookStore.test.ts`): drive **every** row through
    `resolveDraftKind`/`resolveDraftSeverity` and assert `=== expected`. Rows with
    `serverApplicable: true` are the parity rows — the same input, the same
    expected output, in both runtimes. Rows with `serverApplicable: false` are
    draft-only (the server has no draft concept) and are pinned against the table
    alone. **State this split in a comment at the top of both files** so a future
    maintainer does not try to drive draft cases through the server resolver.
  - **Naming collision — resolved here, one path only:** the change-brief says
    `resolveKind`/`resolveSeverity`; `technical-plan.md` Step 9.3 says
    `resolveDraftKind`/`resolveDraftSeverity`. **Ship `resolveDraftKind` /
    `resolveDraftSeverity`** — the plan is dated later, and the `Draft` prefix makes
    the bounded-to-unsaved-draft-state scope self-documenting at every call site,
    which is exactly what a knowingly-duplicated helper needs. Update the
    change-brief's file table to match; do not ship both names.
  - **Formula to pin against:** `(draft !== undefined ? draft : p.kindOverride) ?? p.kind`.
    Write the assertions from the shipped implementation, not from this document —
    `null`-as-"explicit clear" vs `undefined`-as-"not yet touched" is easy to get
    backwards, and the table above is the contract both sides must satisfy.

### Layer 5 — Client component (Vitest + Testing Library)

**`client/src/pages/__tests__/PlaybookPage.test.tsx` — EXTEND** (this file already
exists with 10 passing tests, contra the technical plan's "new file" framing).

- **Fixture extension first** — add `kindOverride: null`, `severityOverride: null`,
  `resolvedKind`, `resolvedSeverity` to **both** existing fixtures (`PRACTICE`,
  `ACCOUNT_BALANCE_PRACTICE`, lines 16-38). Also update
  `updatePracticeConfig.mockResolvedValue(...)` (line 63) per-test so the mock does
  not keep returning stale pre-override fields.
- **T7 — live preview updates before save (the load-bearing client test).**
  `it("changing the kind selector updates the live preview immediately, before any save")` —
  assert the preview starts on the catalog label, `selectOptions(getByLabelText(/kind/i), "good")`,
  `waitFor` the preview badge to become `kindLabel.good`, and assert
  `expect(updatePracticeConfig).not.toHaveBeenCalled()`. **Run this against both
  card fixtures** (`it.each` over the two, or two explicit tests) — one card passing
  proves nothing about the other; this is the §9.4 shape one layer up the stack, and
  it is the **only** place in the entire stack where the `PlaybookPage.tsx:257`/`:335`
  regression can be caught.
- **T7b — supporting client cases:** selectors render defaulted to "use default"
  naming the catalog value; saving sends `kindOverride`/`severityOverride` in the
  patch; selecting "use default" after an override sends `kindOverride: null`. Run
  each against both card fixtures (DEC-2: the mechanism is generic; a selector
  wired into only the first card is the per-practice special-case the plan forbids).
  If the implementer changes the copy in `technical-plan.md` Step 8's table, update
  these assertions to match the shipped strings — not the other way around.
- **T7c — explicit non-assertion comment** (no test case; a guard against a future
  *wrong* test). Add at the top of the file:

  ```ts
  // This page only ever shows the live RESOLVED value (draft or saved) — it never
  // renders a persisted coach_observations row's frozen kind/severity. Per §9.1's
  // explicit INVERTED application here (technical-plan.md §2.4/§5): do NOT add a
  // "UI must match a Feed row" cross-check. The two are supposed to diverge after
  // an override change; asserting they match would demand the wrong behavior.
  ```

### Fixtures / test data

- **New:** `server/__tests__/fixtures/playbook-resolution-cases.json` (T8's shared
  case table — the only new fixture file in this plan, and the only one that must
  be new, because it is what makes the parity test a parity test rather than two
  independent tests of two independent assumptions).
- **Everything else: reuse existing.** Engine tests reuse
  `seedSession`/`seedTokens`/`seedAccount`; route tests reuse the `get`/`put`
  helpers; migration tests hand-build their legacy DBs in `before()` with raw
  `better-sqlite3`, matching every existing "legacy DB" in this repo (there are no
  fixture DB files anywhere in the tree and this plan does not introduce one);
  client tests extend the file's existing `PRACTICE`/`ACCOUNT_BALANCE_PRACTICE`
  fixtures and `vi.mock("../../lib/api", …)`.

### Layer reconciliation — what I moved, and why

Explicit record of where I overrode `unit-tests.md` or `e2e-tests.md`:

1. **Migration boot assertions moved entirely to the unit/data layer.**
   `unit-tests.md` §4a/§4b and `e2e-tests.md` §4.2 items 1–7 are the same six-plus-three
   assertions written twice. They are owned **once**, by
   `coach-observations-severity-rebuild.test.js` (T3a/T3b). The e2e layer keeps only
   the assertion that genuinely needs a booted server: T3c
   (`createApp()` + real `GET /api/coach/observations` against the migrated DB).
   Rationale: a second real server boot buys no confidence about DDL correctness and
   costs a second process start.
2. **Frozen-snapshot permutations stay at the engine layer; e2e keeps exactly one
   frozen re-read.** T2a/T2b own the full 3-step × 2-scope × 2-field matrix via
   direct `stmts` access. T5e re-proves the invariant **once**, session scope only,
   through real HTTP — and does **not** repeat the global-scope twin. `e2e-tests.md`
   §6 already drew this boundary correctly; this plan ratifies it.
3. **Enum-value pinning moved DOWN from an e2e response sweep to a registry-derived
   data-layer assertion.** `e2e-tests.md` §4.1's "no unresolved placeholder reaches
   the response" is better served by T3d (DDL CHECK vs. exported `KIND_VALUES`/
   `SEVERITY_VALUES`), which catches the drift at its source rather than at one
   endpoint. T5e retains it only as a cheap inline spot-check.
4. **Client resolver precedence permutations moved OUT of the DOM test.**
   `unit-tests.md` §6 tests the client copy against its own assumed formula and says
   so. That permutation matrix now lives in T8's shared table (pure functions, both
   runtimes); the DOM test (T7) keeps exactly one wiring proof per card. A DOM test
   can only observe the rendered label, never which branch of the ternary produced it.
5. **i18n completeness assigned an owner.** `e2e-tests.md` §6 correctly declined it;
   `unit-tests.md` §5a asserts English only; it fell between the two documents and
   was owned by nobody. It is assigned below (N1) to the server-side registry-derived
   scan, and stays in the deferrable tier per the strategist.

---

## Implementation steps

Numbered, sequenced, dependency-ordered, each independently checkable. **Steps 1–2
gate everything after them.** Worst-first thereafter, matching `risk.md` §7's
priority ranking: a broken rebuild bricks the ability to run any of the rest of the
suite against a real upgraded DB.

**Phase 0 — plan fixes (gate)**

1. **Land F1** — rewrite `server/db.js`'s `coach_observations` rebuild as a single
   `BEGIN…COMMIT` `db.exec`, create-new-then-rename, with `PRAGMA foreign_keys = OFF`
   outside the transaction, and both indexes recreated after. Checkable: `git diff`
   shows one `db.exec` containing all four DDL statements.
2. **Land F2** — add the orphan check to the idempotency guard; log-and-skip, never
   throw. Checkable: the guard reads `sqlite_master` for
   `coach_observations_old`/`_new` and there is no `throw` on that path.

**Phase 1 — P0: the rebuild (T1, T3)**

3. **Write T1a** (structural atomicity scan). **Red-first:** temporarily revert the
   rebuild to the `plan_items` shape (separate unwrapped `ALTER`/`CREATE`/`DROP`
   statements) — T1a must fail naming §9.6; restore F1 — it must pass. Record the
   observation in the commit message.
4. **Write T1b** (interruption). **Red-first:** against the same temporary
   non-atomic revert, T1b must fail with the original rows unreachable (they are in
   `coach_observations_old` while `coach_observations` is empty and CHECK-bearing);
   against F1 it must pass. **This is the test that proves F1 actually shipped.**
   Restore F1 and byte-diff the tree before committing.
5. **Write T1c** (orphan guard). **Red-first:** remove F2's `!orphanExists` clause —
   the test must fail (the rebuild proceeds and the orphan is destroyed or the boot
   misbehaves); restore F2 — it must pass.
6. **Write T3a** (clean upgrade, 6 assertions). **Red-first:** assertions 2, 3, 5
   are inherently red against the pre-F1 tree (no rebuild exists, so the CHECK is
   never added and a `'critical'` insert succeeds instead of throwing).
7. **Write T3b** (WATCH-3 skip, exactly-one-bad-row fixture). **Red-first is
   subtler and must not be skipped:** pre-build, "does not throw" and "CHECK absent"
   both pass *trivially*. Prove the skip path is real by temporarily disabling the
   pre-flight scan in the rebuild code — T3b's "does not throw" must then start
   failing (a rebuild-always implementation throws on `'critical'` during the
   `INSERT INTO … SELECT`). Restore and record.
8. **Write T3d** (DDL CHECK vs. exported enums). **Red-first:** temporarily add a
   third value to the DDL's CHECK list without touching `SEVERITY_VALUES` — the
   deep-equal must fail.
9. **Write T3c** (real server boots against the migrated DB, `GET /api/coach/observations`
   returns the legacy rows with original `kind`/`severity`). Naturally red pre-build.

**Phase 2 — P1: the frozen-snapshot invariant (T2)**

10. **Write T2a and T2b together** — do not write one and defer the other; the
    single-scope version is §9.4's exact trap. **Red-first (mandatory, §9.3):** run
    both against the pre-change engine. They must fail on the `second.kind` /
    `second.severity` assertion, because pre-change `engine.js:97-98`/`:145-146`
    write the bare catalog constant regardless of any stored override. Record both
    red observations in the commit message — a regression test with no recorded red
    state is not a regression test.
11. **Write T2c** (`updateCoachObservationStatus` isolation). Naturally green
    pre-change and post-change; its value is being named and greppable, so land it
    but do not count it as a red-proven guard.

**Phase 3 — P1: the route round trip (T5, T6)**

12. **Write T5** (PUT 200 **and** follow-up GET shows `resolvedKind` changed).
    Naturally red pre-build (`kindOverride` does not exist, so
    `putRes.body.kindOverride` is `undefined`).
13. **Write T6** (numeric-only PUT does not clear the override). **Red-first with a
    mutation, because "naturally red" is not enough here:** once the route exists,
    temporarily switch the key-presence check from `in`-based to
    `=== undefined`-based — T6 must fail. This is the one-line-away-from-wrong
    pattern `risk.md` §5 flags; add a comment at the call site warning a future
    maintainer not to "simplify" it back to `{ ...row.config, ...body }`.
14. **Write T5b–T5d** (400s, clear-to-default, cross-practice isolation). Naturally
    red pre-build.
15. **Write T5e** (the one HTTP round-trip flow, new `describe` block). Naturally
    red pre-build.

**Phase 4 — P1: the guards (T4, T8)**

16. **Write T4a/T4b/T4c** in `playbook-resolver-guard.test.js`. **Red-first, exact
    procedure, mandatory (§9.3):**
    (a) with the resolver/engine/route/client changes landed, add
    `const rogue = practice.kind;` inside `evaluateSession()` in `engine.js`, run
    `node --test server/__tests__/playbook-resolver-guard.test.js` — **T4b must
    fail naming `engine.js`**; remove it.
    (b) add `const rogue = practice.kind;` inside `SessionTokenCeilingCard` in
    `PlaybookPage.tsx`, run the same command (no client build step — the guard is a
    server-side `node:test` file that walks `client/src` as plain text) — **T4c must
    fail naming `PlaybookPage.tsx`**; remove it.
    (c) re-run: both green. `git diff` to confirm the tree is back to its real state.
    (d) record verbatim in the commit message: *"playbook-resolver-guard.test.js
    proven red by injecting a rogue `practice.kind` reader into `engine.js`'s
    `evaluateSession()` and into `PlaybookPage.tsx`'s `SessionTokenCeilingCard`;
    both assertions failed as expected; reverted."*
    (e) sweep: `grep -n "assert.ok(true" server/__tests__/playbook-resolver-guard.test.js`
    and `grep -n "|| true" …` must both return nothing.
17. **Write the T8 case table** (`server/__tests__/fixtures/playbook-resolution-cases.json`)
    **first**, then both halves against it. **Red-first:** temporarily change the
    client's `resolveDraftKind` to `p.kindOverride ?? draft ?? p.kind` (a plausible
    wrong ordering) — the parity rows must fail on the client half while the server
    half stays green. That divergence-visible-in-exactly-one-half failure is the
    signal T8 exists to produce. Also confirm the out-of-enum row fails the client
    half if the client omits the enum-validity check the server's `coerceEnum`
    applies — the most likely real-world drift.

**Phase 5 — P1: the client (T7)**

18. **Extend both fixtures** with the four new fields before writing any client
    test (do not clone a parallel fixture).
19. **Write T7 against both cards.** **Red-first:** run it once against the
    unpatched `PlaybookPage.tsx` (bare `kind={practice.kind}` at lines 257/335) —
    selecting "good" must leave the preview showing the catalog label, i.e. the
    assertion on `kindLabel.good` fails. Then patch both lines and confirm green.
    Record. **Patch both lines in the same step** — fixing one card is the same
    §9.4 shape as fixing one engine call site.
20. **Write T7b** (selector defaults, save payload, clear-to-null), both cards.
    Naturally red pre-build.
21. **Add the T7c non-assertion comment.**

**Phase 6 — durable cure (see §Durable-cure decision)**

22. **Extract `rebuildTableAtomically({ table, createSql, copySelect, indexes })`**
    in `server/db.js` and route the `coach_observations` rebuild through it. This is
    a refactor of code written in step 1, not new behaviour — T1a/T1b/T3a must stay
    green across it with no edits. **Do not retrofit the five existing rebuild
    sites in this change.**
23. **Extend `db-migration.test.js`'s meta-test with a `REBUILD_CASES` registry.**
    Second scan for `ALTER TABLE (\w+) RENAME TO \1_old` and `CREATE TABLE (\w+)_new`;
    every site found must appear in `REBUILD_CASES` carrying **both** a legacy-DB
    case and an interruption case. **Red-first:** it will immediately light up the
    five existing non-atomic sites (`server/db.js` lines 755, 822, 1063, 1439, 1589)
    — that failure **is** the proof the scan works. Grandfather those five with a
    dated list and a per-entry reason, exactly as `chronology-ordering.test.js` does.
    **Do not weaken the scan to make them pass.** `coach_observations` must appear
    as a real (non-grandfathered) entry.

**Phase 7 — final gates**

24. Run the full suite (`npm test`) green, server and client.
25. Back up the real `dashboard.db`; do the §6.6 manual double-boot walkthrough
    against a **copy** (F3).
26. `grep -rn "resolvedKind" server/__tests__ client/src --include=*.test.*` and
    review by eye: **no test anywhere asserts that a stored Observation's `kind`
    equals a live-resolved `resolvedKind` after an override change.** That equality
    is the *wrong* criterion on this surface; if such an assertion exists and
    passes, the freeze has been broken to satisfy it.

---

## Single-source-of-truth guardrail

This project has three canonical registries in play, and the tests must assert the
rendered paths agree with them — never bless a hand-edited path that bypasses them.

1. **`resolvePracticeConfig()` in `server/lib/playbook/practices.js` is the sole
   server-side producer of effective `kind`/`severity`.** Every consumer assertion
   in this plan compares against *that function's output*, never against a
   hand-rolled expectation of what it should have returned. T4a/T4b/T4c enforce
   this structurally (raw `practice.kind` reads may exist only in `practices.js` and
   `types.ts`), and T5 enforces it behaviourally (a route that echoes the request
   body instead of re-resolving fails the follow-up GET).

2. **`KIND_VALUES` / `SEVERITY_VALUES` (exported from `practices.js`) are the
   canonical enums, and they drive four rendered outputs**: the DB `CHECK`
   constraints, `validateOverridePatch()`, the client `ObservationKind` /
   `ObservationSeverity` unions, and the i18n label keys. **T3d asserts the DDL's
   CHECK value list deep-equals the exported array** — a hand-edited CHECK that
   drifts from the registry fails. N1 (deferrable) extends the same idea to i18n:
   derive the expected label keys from `KIND_VALUES`/`SEVERITY_VALUES` and assert
   each exists in all four locale files, rather than hardcoding a key list that will
   itself drift.

3. **`PRACTICES` (2 entries today) is the practice registry, and the override
   mechanism must be generic across it (DEC-2).** Every client test in T7/T7b runs
   against **both** card fixtures, and T2 runs against both scopes. A control wired
   into only the first card, or a resolver honoured only by one evaluator, is the
   per-practice special case the plan forbids.

4. **`REBUILD_CASES` (durable cure D2) becomes a fourth registry**: registry
   *completeness* — a new table rebuild either ships with a legacy-DB case and an
   interruption case, or the suite fails. This is the mechanism that converts §9.6
   from a written lesson into an enforced one.

**Inverse warning, over-communicated because it is easy to get backwards:** the
frozen `coach_observations.kind` and the live-resolved `resolvedKind` are two
**intentionally divergent** views. §9.1's usual "all consumers agree" criterion
does **not** apply between them. An assertion of the form
`observation.kind === serializePractice(practice).resolvedKind` after an override
change is not a stronger frozen-snapshot test — it is a test for the opposite,
wrong behaviour, and if written and made to pass, the freeze was broken to satisfy
it. No trigger, computed column, view, or backfill that re-syncs historical
Observations may be added. Step 26 is the mechanical check for this.

---

## Durable-cure decision

**Call: build the structural cure now — D1 and D2 both — and defer only the
retrofit of the five pre-existing sites.**

- **D1 (`rebuildTableAtomically()` helper) — BUILD NOW (step 22).** We are writing
  an atomic rebuild for `coach_observations` in step 1 regardless; expressing it as
  a helper instead of inline costs roughly nothing and stops atomicity from being
  re-decided by hand at the next site. `server/db.js` has six rebuilds, no shared
  helper, and exactly one of the six is correct — the marginal cost is a function
  signature, and the marginal benefit is that the seventh rebuild is atomic by
  construction.
- **D2 (`REBUILD_CASES` registry-completeness meta-test) — BUILD NOW (step 23).**
  This is the one that kills the class. Today the §9.5 meta-test scans
  `ALTER TABLE … ADD COLUMN` only, so **all six** rebuilds are outside its field of
  view and it reports clean whether or not this rebuild is ever written, and whether
  or not it is atomic. A scanner that under-scans is worse than none, because the
  next reader sees a tick. Expect D2 to light up all five existing sites on its
  first run — that is a feature, and the same cure paid for itself immediately on
  §9.2 in 2026-08-01 (its first run found three unrelated pre-existing bugs).
  Grandfather the five with a dated list and per-entry reasons.
- **Retrofit of the five existing non-atomic rebuilds — DEFER** to a separate
  change with its own backup and its own crash tests. `plan_items` and `token_usage`
  are not this feature's blast radius, and widening it here trades a contained
  change for an uncontained one.

**Consequence of deferring D2 (if the build team overrides this call):** the point
tests (T1a/T1b) guard *this one* rebuild and nothing else. The next rebuild written
in this repo — by anyone, at any time — will again be copied from whichever
neighbour the author happens to read, and five of the six neighbours are wrong. The
suite will report clean. Per `PROJECT-CONTEXT.md` §9.6 the failure mode is silent,
total, and indistinguishable from success. If D2 is deferred, that deferral needs a
`decisions.md` WATCH row naming §9.6 and the five live instances — it must not exist
only as prose in this plan.

**Consequence of deferring D1:** minor and recoverable — the seventh rebuild
re-decides atomicity by hand. Acceptable in isolation, but pointless to defer given
D1's cost is a refactor of code being written anyway.

---

## Nice-to-have — deferrable, does NOT gate the change

Land these if there is room; do not hold the merge for them.

- **N1 — i18n four-locale completeness.** Currently owned by neither test design
  document (`e2e-tests.md` §6 correctly declined it, `unit-tests.md` §5a asserts
  English only). **Owner assigned: a server-side JSON scan**, in
  `playbook-resolver-guard.test.js` (a static file scan already lives there, so no
  new file). Build it **registry-derived**: for every value in `KIND_VALUES` and
  `SEVERITY_VALUES`, assert a corresponding `kindLabel.*` / `severityLabel.*` key
  exists in all four of `client/src/i18n/locales/{en,vi,zh,ko}/coach.json`, plus the
  new `playbook.*` selector keys. A missing key renders the raw key string to the
  user with no failure anywhere — silent, one-locale-only, and cheap to prevent.
- **N2 — mechanised no-re-sync check.** Step 26 is currently a human grep/review
  pass. A one-line scan in the resolver-guard file asserting that no test file
  contains an `observation.kind`-vs-`resolvedKind` equality would mechanise it and
  protect against a *future* reviewer applying §9.1 by rote and "fixing" the
  intentional divergence.
- **N3 — concurrent-process rebuild race** (`risk.md` §4.3). A **manual one-time
  check**, not a `node:test` case: start two processes against the same
  freshly-copied real DB near-simultaneously and confirm one wins cleanly and the
  other waits or fails retryably. Note that F1 makes the losing process fail
  **loudly at `BEGIN`** rather than interleave — loud-and-retryable is the outcome
  we want. Add it to the manual checklist alongside F3's walkthrough.

---

## How to run

`PROJECT-CONTEXT.md` configures no test-command overrides; these are discovered
from `package.json` (confirmed) and the existing spec-file conventions.

```bash
# Full gate — server + client. Required green before AND after.
npm test

# --- Server layer (node:test) ---
npm run test:server                                                    # all server specs
node --test server/__tests__/coach-observations-severity-rebuild.test.js   # T1, T3 (new file)
node --test server/__tests__/playbook.test.js                          # T2, T5, T6
node --test server/__tests__/playbook-resolver-guard.test.js           # T4 (new file), N1, N2
node --test server/__tests__/playbook-resolver-parity.test.js          # T8 server half (new file)
node --test server/__tests__/db-migration.test.js                      # D2 REBUILD_CASES meta-test

# Narrow to one block while iterating:
node --test --test-name-pattern="API round trip through a live engine tick" \
  server/__tests__/playbook.test.js

# --- Client layer (Vitest) ---
npm run test:client
cd client && npx vitest run src/pages/__tests__/PlaybookPage.test.tsx   # T7
cd client && npx vitest run src/lib/__tests__/playbookStore.test.ts     # T8 client half (new file)

# --- Structural spot-checks (must return nothing / must pass) ---
grep -n "practice\.kind\|practice\.defaultSeverity" server/lib/playbook/engine.js   # must be empty post-build
grep -n "assert.ok(true\||| true" server/__tests__/playbook-resolver-guard.test.js  # must be empty
```

No base URL, no external stack, no environment bring-up: every spec sets its own
`DASHBOARD_DB_PATH` to a fresh temp SQLite file, starts its own Express app on an
OS-assigned port when it needs HTTP, and cleans up `-wal`/`-shm` in `after()`.
`npm run test:mcp` and `npm run desktop:test` are **not** required — neither surface
is touched.

---

## Definition of Done

**Plan fixes**
- [ ] **F1** — the entire `coach_observations` rebuild is one `BEGIN…COMMIT`
      `db.exec`, create-new-then-rename, `PRAGMA foreign_keys = OFF` outside the
      transaction, both indexes recreated. (Or: F1 declined **and** a `decisions.md`
      WATCH row exists naming the silent-total-data-loss mechanism.)
- [ ] **F2** — idempotency guard gates on `hasCheck && !orphanExists`; logs loudly
      and **skips** on an orphan; contains no `throw` on that path.
- [ ] **F3** — real `dashboard.db` backed up; §6.6 manual double-boot walkthrough
      done against a copy.

**Tests added (all 8 gating groups)**
- [ ] **T1** — atomicity: structural scan (T1a) + interruption test (T1b) + orphan
      boot guard (T1c), in `coach-observations-severity-rebuild.test.js`.
- [ ] **T2** — frozen snapshot, **both scopes as two independent tests** (T2a global,
      T2b session), asserting `kind` **and** `severity` at every step, + T2c status
      isolation.
- [ ] **T3** — migration: 6 clean-path assertions, 3 WATCH-3 skip-path assertions
      (fixture with **exactly one** bad row), registry-derived CHECK assertion (T3d),
      real-Express-boot proof (T3c).
- [ ] **T4** — `playbook-resolver-guard.test.js` with all three assertions.
- [ ] **T5** — PUT 200 **and** follow-up GET showing `resolvedKind` actually changed
      (+ T5b–T5d, + the T5e HTTP round trip).
- [ ] **T6** — numeric-only PUT leaves an existing `kindOverride` intact.
- [ ] **T7** — live preview updates before save, run against **both** cards.
- [ ] **T8** — one shared JSON case table driven through both the server resolver
      and the client draft resolver, identical results, including the out-of-enum
      fail-safe row.

**Red-first evidence (§9.3 — a guard with no recorded red state is not a guard)**
- [ ] T1a and T1b observed RED against a temporary `plan_items`-style non-atomic
      rebuild, GREEN against F1 — recorded in the commit message.
- [ ] T1c observed RED with F2's `!orphanExists` clause removed.
- [ ] T2a **and** T2b each observed RED against the pre-change engine (both fail on
      `second.kind`/`second.severity`) — **both** recorded; one recorded red does
      not cover the other.
- [ ] T3b's skip path observed RED with the pre-flight scan temporarily disabled
      (not merely "trivially passing pre-build").
- [ ] T3d observed RED with a value added to the DDL CHECK but not to `SEVERITY_VALUES`.
- [ ] T4b observed RED by injecting `const rogue = practice.kind;` into
      `engine.js`'s `evaluateSession()`; T4c observed RED by injecting the same into
      `PlaybookPage.tsx`'s `SessionTokenCeilingCard`; both reverted; the verbatim
      note is in the commit message; `git diff` confirms a clean tree.
- [ ] T6 observed RED with the key-presence check switched from `in`-based to
      `=== undefined`-based.
- [ ] T8 observed RED with the client resolver's precedence deliberately inverted —
      failing on the **client half only**, which is the divergence signal.
- [ ] T7 observed RED against the unpatched `PlaybookPage.tsx` lines 257/335, on
      **both** cards.

**Registry / source-of-truth in sync**
- [ ] DDL `CHECK(severity IN …)` and `CHECK(kind IN …)` deep-equal the exported
      `SEVERITY_VALUES` / `KIND_VALUES` (T3d green).
- [ ] `grep -n "practice\.kind\|practice\.defaultSeverity" server/lib/playbook/engine.js`
      returns nothing.
- [ ] Helper name shipped as `resolveDraftKind` / `resolveDraftSeverity` (one name,
      not two); the change-brief's file table updated to match.
- [ ] `library/knowledge/product/coach/coach-playbook-vocabulary.md` `kind` enum
      corrected to `risk/info/good` and `defaultSeverity` documented — landed in the
      **same commit** as the schema change (DEC-3's own 8-hour-drift precedent).

**Durable cure**
- [ ] **D1** — `rebuildTableAtomically()` exists in `server/db.js` and
      `coach_observations` routes through it; T1/T3 stay green across the refactor
      with no test edits.
- [ ] **D2** — `REBUILD_CASES` registry meta-test in `db-migration.test.js` scans
      `RENAME TO \1_old` / `CREATE TABLE (\w+)_new`, requires a legacy-DB case **and**
      an interruption case per site, and carries a **dated grandfather list with
      per-entry reasons** for the five existing sites. `coach_observations` is a real
      entry, not grandfathered. (Or: D2 deferred **and** a `decisions.md` WATCH row
      exists naming §9.6 and the five live instances.)

**Suite**
- [ ] `npm test` green (server + client), before and after.
- [ ] The pre-existing `"400s on an unknown config field"` / below-min route tests
      still pass **unedited** (`validateConfigPatch()` is not modified).
- [ ] Step 26 review done: **no test anywhere asserts a stored Observation's `kind`
      equals a live-resolved `resolvedKind` post-override.** T7c's non-assertion
      comment is in `PlaybookPage.test.tsx`.
