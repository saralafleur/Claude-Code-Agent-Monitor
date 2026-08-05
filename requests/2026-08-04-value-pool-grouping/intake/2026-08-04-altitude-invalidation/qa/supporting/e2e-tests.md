# E2E / API-Contract Test Design — altitude invalidation (Slice 1)

> Authored by the E2E / API Test Architect. Substrate: `origin/master` @ `55fe900`
> (read via `git show origin/master:<path>` — the local checkout is behind and
> dirty; never resolve against it). The change is **planned, not built**: paths
> below are where the tests land on the effort worktree
> (`effort/2026-08-04-altitude-invalidation`).

## 0. This project's "e2e" convention (discovered, not assumed)

There is no Cypress/Playwright layer. The e2e/contract layer here is **real HTTP
against a real `createApp()`/`startServer(app, 0)` on a temp SQLite DB**, with
exactly one fake: the `claude -p` spawn, injected via
`focus-inference.__injectSpawnForTest`. The living examples are:

- `server/__tests__/value-summary.test.js` — already hosts the
  `POST /api/project-plans/altitudes` **route-contract bucket** (its file header
  names the route contract as in-scope), with the `fetch`/`post` helper,
  `fakeSpawn`, `envelope()`, `unit()` and `makeProject()` fixtures.
- `server/__tests__/project-plans-api.test.js` — the broader project-plans route
  bucket ("boots the real app on a temp DB against throwaway fixtures").
- `server/__tests__/db-migration.test.js` — the **legacy-DB regression bucket**
  (`UPGRADE_CASES`, require-cache-refresh harness).

**Bucket scheme** = spec files. `npm run test:server` is
`node --test server/__tests__/*.test.js` (package.json:92), so each file is its
own process (fresh `require()`-time migrations) and any new `*.test.js` file is
picked up with no registration. There is no smoke/regression **tag** system;
suite membership *is* the tag. "Serial" is per-file by construction: everything
in one file shares one temp DB and one spawn seam, so isolation inside a file is
by unique `unit_key`s / project ids (the existing convention), not by DB wipes.

## 1. Flows to cover (plain language)

1. **Staleness lifecycle over HTTP** — generate a mutable unit through the
   route; re-request identically → served from cache, zero spawns; re-request
   with the stage changed → exactly that unit regenerates, siblings stay
   cached; the response says *why* (`freshness`/`update_reason`).
2. **Acknowledge round-trip** — `POST /altitudes/seen` clears the marker on the
   next read; a *later* regeneration brings the marker back (seen state does
   not survive newer change).
3. **Request-path logging** — a route-driven generation writes a
   `source='request'` log row whose four-term partition is exact, with
   `stale_regenerated` riding as an overlap counter.
4. **Old-client compatibility** — freshness is strictly additive: an untouched
   fresh unit's response entry is byte-identical before and after the slice's
   machinery engages on its siblings.
5. **Tick heals staleness end-to-end** — the background sweep regenerates a
   stale unit, and the *next route read* serves the new text with the
   `updated_unseen` marker (the "user is told on next view" promise, OPEN-1's
   reduced form).
6. **Legacy-DB boot** — an app booted on a pre-slice DB migrates cleanly at
   `require()` time and serves a legacy cached mutable row as stale
   (regenerates on first read) while a legacy `trunk_commit` row serves
   cached — the `resumeJobPipelineTracker` scenario, at the HTTP surface.

## 2. Spec files and cases

### 2.1 Extend `server/__tests__/value-summary.test.js` (route-contract bucket)

This file already owns the altitudes route contract (S2/S4/Case A blocks at
~485-650) — extend it; do not fork a parallel route spec. Reuse `post()`,
`fakeSpawn`, `envelope()`, `unit()`, `makeProject()`. Wrap the injected spawn in
a local counter (`let spawnCount = 0`) — the file already inspects spawn args in
the "batches multiple misses" case, so this is in-convention.

**New `describe("POST /altitudes staleness lifecycle over HTTP")`** — one
3-unit batch reused across steps: `intake_initiative` unit A (stage
`in_progress`), `intake_initiative` unit B, `trunk_commit` unit C.

- **E1 — seed + cache hit.** POST once (spawn resolves all 3), then POST the
  identical batch again. Assert on the second call: status 200; all 3 in
  `altitudes`; **zero spawns**; the newest `value_summary_generation_log` row
  has `source='request'`, `pool_size=3`, `cache_hits=3`, `generated=0`,
  `queued=0`, `unavailable=0`, `stale_regenerated=0` (a *measured* zero — new
  writes always stamp it; only pre-slice rows are NULL), and
  `cache_hits + generated + queued + unavailable === pool_size`. This is
  flow 3's positive leg and the deliberate-red widening of the
  `insertValueSummaryGeneration` guard made observable at the wire.
- **E2 — stage change regenerates exactly one unit.** Same batch, unit A's
  `stage` now `"shipped"`. Assert: **exactly 1 spawn**; unit A's entry carries
  new text, `freshness: "updated_unseen"`, `update_reason: "stage_changed"`,
  `regenerated_at` set; units **B and C entries `deepEqual` their E1 entries**
  (this single assertion is flow 4 — additive-only, no freshness churn on
  unchanged units, which is what actually protects an old client; also assert
  `!("freshness" in entryB)` — absent, not null); log row: `pool_size=3`,
  `cache_hits=2`, `generated=1`, `stale_regenerated=1`, identity exact.
  **Do NOT assert log/wire agreement for stale units — DEC-11 says they
  disagree by design; a test asserting agreement is asserting a bug.**

**New `describe("POST /api/project-plans/altitudes/seen")`** —

- **E3 — acknowledge round-trip.** After E2's shape: seen with
  `{project_id, unit_keys: [A]}` → `{updated: 1}`; re-POST the same batch →
  unit A's entry has **no `freshness` key** and its text is unchanged (cache
  hit, zero spawns — acknowledging must not trigger work). Double-acknowledge
  → still 200 (idempotent unconditional SET).
- **E4 — acknowledge-then-regenerate.** Change unit A's stage again → the
  marker **re-appears** (`freshness: "updated_unseen"`, fresh
  `regenerated_at`). This pins G3's `seen_at = NULL` reset living inside the
  one writer, observed from the outside.
- **E5 — validation contract.** 400 on missing/empty/non-array `unit_keys` and
  missing `project_id`, mirroring the existing "400s without project_id or
  units[]" case shape. One test, three sub-asserts.

**New `describe("tick-to-route staleness handoff")`** — flow 5, one test:

- **E6.** Import `runValueSummaryTickOnce` + `__injectPoolAssemblerForTest`
  from `../lib/value-summary-tick` (same process, same temp DB — fine). Create
  a project **with** `stmts.insertProjectPath` (the tick only sweeps projects
  that have a `project_paths` row; the file's other `makeProject()` projects
  have none, so the sweep cannot see them — state this in a comment, it is the
  serial-safety argument for cohabiting with the tick). Seed a mutable unit via
  the route at stage X; inject a pool assembler returning the same unit at
  stage Y; `await runValueSummaryTickOnce(dbModule, { broadcast: () => {} })`.
  Assert: newest log row `source='tick'`, `generated=1`,
  `stale_regenerated=1` (tick row shape otherwise unchanged — same columns the
  existing tick tests read); then POST `/altitudes` with stage Y → **zero
  spawns**, the tick's new text, `freshness: "updated_unseen"` present on the
  route read. That is signal 5 end-to-end as actually shipped (marker on next
  view, no WebSocket push).

### 2.2 New file `server/__tests__/value-summary-legacy-boot.test.js` (serial/state-dependent bucket)

Flow 6 needs a **clean process whose very first `require("../db")` runs the
guarded ALTERs against a pre-built legacy DB** — `db-migration.test.js`'s
require-cache surgery covers `../db` alone, but a full HTTP boot drags the whole
`../index` module graph, so cache surgery is the wrong tool. A dedicated file is
this repo's natural serial bucket: one file = one process = one boot.
(`node --test server/__tests__/*.test.js` picks it up automatically.)

Sequence (before any `require` of server code):
1. Set `process.env.DASHBOARD_DB_PATH` to a unique temp path (same
   `Date.now()-pid` pattern as the siblings — the TEST-AGAINST-LIVE-DB rule;
   this file ships in a schema-shipping slice, it must be exemplary).
2. With raw `better-sqlite3` (resolve with the same try/`compat-sqlite`
   fallback `db-migration.test.js` uses), create **only** the two value tables
   using the **pre-slice CREATE bodies verbatim** from `55fe900`'s
   `server/db.js` (826-832 and 1822-1835 — same technique as `UPGRADE_CASES.legacySql`).
   Seed: the `resumeJobPipelineTracker` row
   (`intake_initiative::2026-08-03-job-pipeline-tracker::<cwd>`, text *"The job
   pipeline tracker is built and being tested"*), one `trunk_commit::` row, one
   legacy log row. Close the handle.
3. `require("../index")` → `createApp()`/`startServer(app, 0)` — migrations run
   here, against a DB that already has the legacy-shaped tables (`CREATE IF NOT
   EXISTS` no-ops, the PRAGMA-guarded ALTERs fire).

Cases:
- **B1 — clean boot + columns present.** No throw; `PRAGMA table_info` shows
  the 5 new `value_unit_summaries` columns and `stale_regenerated` on the log;
  the legacy rows read **NULL** in every new column (log row: NULL, not 0 —
  DEC-3 at the boot surface).
- **B2 — legacy mutable row is stale over HTTP.** POST `/altitudes` with the
  resume unit at its **current** stage/label (values that would compare
  "fresh" if anyone had implemented backfill-on-migrate) → **one spawn**, new
  text replaces the seeded sentence, `freshness: "updated_unseen"`, and the
  request log row records `generated=1`, `stale_regenerated=1`. This is DEC-9
  (`input_label IS NULL` ⇒ stale, as an absence of code) proven at the API.
- **B3 — legacy `trunk_commit` row is fresh.** Same POST includes the seeded
  commit unit → served cached, zero additional spawns, no `freshness` key
  (PO AC-1 as restated by DEC-6: `trunk_commit` byte-for-byte unchanged).

New-file obligations: file-overview header + the exact
`@author Son Nguyen <hoangson091104@gmail.com>` line
(`bash .claude/skills/file-headers/scripts/check-headers.sh` must stay 0).

### 2.3 No changes here (deliberately)

`project-plans-api.test.js` — the altitudes contract already lives in
`value-summary.test.js`; splitting the seen endpoint away from the lifecycle it
acknowledges would orphan its fixtures. `value-summary-tick.test.js` — L1–L3
(planned, unit-integration layer) own the sweep's partition arithmetic; E6
covers the only genuinely cross-file seam (tick write → route read).

## 3. Tag / suite placement

No tag convention exists; placement in `server/__tests__/*.test.js` puts every
case in the only server suite (`npm run test:server`, run per-file, in-process
order within a file). Serial notes: E1–E4 are **order-dependent within their
describe blocks by design** (lifecycle steps) — keep them as sequential `it()`s
in one block, the established pattern in this file (the Case A block already
does seed-then-hit sequencing). E6 must reset the spawn seam
(`__injectSpawnForTest(null)`) and use a dedicated project. The legacy-boot file
is serial at file grain (whole-process precondition), which the per-file runner
gives us for free.

## 4. Key assertions (summary table)

| Case | The one assertion that matters |
|---|---|
| E1 | identical re-POST ⇒ 0 spawns; `source='request'` row exists, 4-term identity exact, `stale_regenerated=0` measured |
| E2 | stage change ⇒ 1 spawn; changed entry carries `updated_unseen`/`stage_changed`; **sibling entries deepEqual their pre-change selves** (old-client shield); never assert log==wire for stale units (DEC-11) |
| E3 | seen ⇒ next read has **no `freshness` key**, still zero spawns; idempotent |
| E4 | later regeneration re-raises the marker (server-side `seen_at` reset by the one writer) |
| E5 | seen endpoint 400s on malformed input, structured error |
| E6 | tick regenerates ⇒ `source='tick'` row with `stale_regenerated=1`; next route read = new text + `updated_unseen`, 0 spawns |
| B1–B3 | pre-slice DB boots clean; legacy NULLs (not 0); legacy mutable stale over HTTP, legacy `trunk_commit` fresh |

No unresolved-placeholder check applies at this layer: the server ships reason
*codes* (`stage_changed`, members of `ALTITUDE_FRESHNESS`), never display copy —
asserting the exact code strings here is what lets the client i18n tests (C1,
E1.1) own the no-hardcoded-English guarantee.

## 5. How to run

```bash
# from the effort worktree — single specs (env prefix is defense-in-depth;
# each file also self-sets a unique DASHBOARD_DB_PATH before requiring ../db)
DASHBOARD_DB_PATH=/tmp/slice1-vs.db  node --test server/__tests__/value-summary.test.js
DASHBOARD_DB_PATH=/tmp/slice1-boot.db node --test server/__tests__/value-summary-legacy-boot.test.js

# full gates
npm run test:server
npm run test:client
bash .claude/skills/file-headers/scripts/check-headers.sh
```

No external stack: the specs boot the app on port 0 themselves and fake the
`claude` spawn. The one environment rule is absolute: `DASHBOARD_DB_PATH` set
in-file **before** the first `require` that touches `../db`, or the run
migrates `~/.claude/agent-dashboard/dashboard.db` (the live, shared DB —
plan Step 1.5 / TEST-AGAINST-LIVE-DB).

## 6. Cost note — what this layer deliberately does NOT cover

E2E here costs a full app boot + HTTP round-trips per case; the minimum set
above (9 cases: E1–E6, B1–B3) proves every wired seam exactly once. Left to the
unit/integration layer (already planned in technical-plan §6):

- Comparator permutations and reason precedence (A1, D3-vs-D4 separation) —
  pure-function territory; E2 pins only `stage_changed` at the wire.
- The 4-cell mutable/immutable × NULL/mismatch truth table (D1/D2), cap
  slicing, stale × over-cap and stale × LLM-down combinations, R3 re-homing,
  Case 5/6 partition exhaustiveness — composer-level fixtures are 10× cheaper
  and already sized to be non-vacuous (L1's 10-vs-15 trick).
- Sweep arithmetic (L1/L2) and structural guards (buildPrompt scan, writer
  counts) — not observable over HTTP at all.
- Client marker rendering / acknowledge wiring (C1–C3, snapshots) — vitest.
- True browser e2e — none exists in this repo; the plan's §6 manual Resume
  walkthrough in real Chrome remains the only human-in-the-loop pass and is
  required by the plan, not replaced by anything here.

Duplication is bounded to one deliberate overlap: E2's per-unit regeneration
echoes D3 at the wire, because the route's sanitization loop
(`project-plans.js:157-170`) is a real seam D3 never crosses — that seam is the
whole reason DEC-7 exists.
