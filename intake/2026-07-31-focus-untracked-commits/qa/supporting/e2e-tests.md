# E2E / API / Integration Test Plan — 2026-07-31-focus-untracked-commits

> Authored by `qa-e2e-architect`. Scoped to the two surfaces the parent task
> called out: the `/api/settings/export` streaming route, and the `/focus`
> page. Everything else in `technical-plan.md` §7 (the hook unit test, the
> `focus-inference.js` chronology regression, the interval stack-overflow
> regression, the `ConcurrencyStatTile` smoke test) is unit-layer work,
> already assigned to that architect — not repeated here.

## 0. This project's e2e ceiling (discovered, not assumed)

Confirmed by inspection — no separate confirmation needed from
`PROJECT-CONTEXT.md`, which only has a `## Repo topology` section (no test
framework claims):

- **No Playwright, Cypress, Puppeteer, or Selenium anywhere in this repo.**
  `grep -i "playwright\|cypress\|puppeteer\|selenium"` across
  `package.json`, `client/package.json`, `server/package.json` returns
  nothing. No `e2e/` directory, no `*.e2e.*` files, no browser-driver config.
- **There is no traditional browser-driven e2e layer.** This is a plain
  statement of fact, not a gap to fill in this pass — the technical plan
  does not authorize adding one, and it isn't needed to close the two gaps
  this brief cares about.
- The **closest thing to "integration" this project has**, in order of
  fidelity:
  1. **Server route tests** (`server/__tests__/*.test.js`, Node's built-in
     `node:test` + `node:assert/strict`) — spin up the real Express app
     (`createApp()`/`startServer()`) on an ephemeral port against a real
     temp SQLite file (`DASHBOARD_DB_PATH` env var), then drive it with a
     hand-rolled `http.request` helper (no supertest dependency; every file
     re-implements a small `fetch`/`post` helper rather than sharing one —
     confirmed convention, see `server/__tests__/focus-report-route.test.js`
     lines 44-77, and the same file's own comment citing "this repo's
     stated do-not-cross-import-between-test-files rule"). This is the
     **API/contract bucket** for this project.
  2. **Full page-load render tests**, React Testing Library, one file per
     routed screen: `client/src/pages/__tests__/screens.snapshot.test.tsx`.
     Mounts every top-level route's page component inside a `MemoryRouter`
     with the whole `api` module mocked to a deterministic empty-but-loaded
     fixture, and snapshots the DOM. This is the project's stand-in for "did
     the page wire up and render at all" — the closest analog to a
     page-load e2e smoke test this repo has.
  3. **Component/page integration tests**
     (`client/src/pages/__tests__/FocusPage.test.tsx`,
     `client/src/components/__tests__/FocusReportModal.test.tsx`, etc.) —
     RTL render + `fireEvent`/`waitFor`, real component tree, mocked `api`
     module. This is where **cross-component/cross-view flow** assertions
     live (e.g. click a filter, confirm a downstream stat tile updates) —
     the actual "prove the wired-up flow" layer for this codebase.
- **No smoke/regression tag or bucket annotation convention exists.** No
  `@smoke`, no `describe.only`-as-bucket pattern, no CI job that greps test
  names for a tag string — confirmed by `grep -rl "smoke\|regression\|@tag\|
  bucket"` across both suites returning only files where those words appear
  in prose comments, not as a structural convention. **Bucket = which
  `describe`/file it lives in and which `npm run test:*` command picks it
  up; tag = none.** Do not invent a tagging scheme this project doesn't have.

Given this ceiling, both gaps below are scoped to real HTTP/DOM assertions
against the actual routed app, at the fidelity this project already uses for
its highest-value coverage — not a new framework, and not a downgrade to a
pure unit test either.

---

## 1. Flows to cover

### A. `/api/settings/export` — functional content correctness (API/contract bucket)

**Flow:** seed real rows across the tables the route streams (`sessions`,
`agents`, `events`, `token_usage`, `model_pricing`) → `GET
/api/settings/export` on the real running app → parse the streamed response
body as JSON → assert every seeded row is present, correctly shaped, and
correctly counted; assert response headers (`Content-Type`,
`Content-Disposition` filename pattern); assert an **empty-DB** call still
produces valid, parseable JSON (`{"exported_at":...,"sessions":[],...}` —
the empty-array edge case of `writeJsonArray`'s `first`/comma bookkeeping).

This is exactly the case the brief flags: the **existing** coverage
(`server/__tests__/api.test.js`'s `EXPECTED_API_PATHS` list, asserted at
line 187 against `GET /api/openapi.json`) only proves the path is
**documented** in the OpenAPI spec — it never issues a real `GET` against
`/api/settings/export` and never inspects a response body. That is a
route-existence/doc-coverage smoke check, not a functional test. Confirmed
by grep: `/api/settings/export` appears exactly once elsewhere in the
server test suite (`data-transfer.test.js`), and that file tests
`server/lib/data-transfer.js`'s `buildExportBundle`/`importExportBundle` —
a **different, unrelated export mechanism** (the backup/restore bundle,
which also includes `workflows`/`dashboard_runs`/`alert_rules` and is
built via `.all()`, not `.iterate()`). It does not exercise
`server/routes/settings.js`'s `GET /export` route or its
`writeJsonArray`/`Statement#iterate()` streaming rewrite at all. Zero
existing test touches the streaming code path `60af828` introduced.

Prefer this API-level test over any UI flow for this surface — the risk
here is entirely in **response-stream correctness** (does the streamed
JSON actually contain what's in the DB, in the right shape, with valid
JSON syntax at every chunk boundary), not in any UI wiring. There's no
meaningful browser flow to add on top: the client-side "download" button
just triggers a same-origin navigation to this URL: it has no bespoke
client-side parsing logic worth a separate render test.

### B. `/focus` page — full page-load integration + cross-view parity

Two sub-flows, deliberately split because they answer different questions:

1. **Page-load smoke ("does `/focus` mount and render at all").** This
   **already exists** —
   `client/src/pages/__tests__/screens.snapshot.test.tsx`, the `it("Focus", ...)`
   test at line 572-573, mounts the real `FocusPage` component inside a
   `MemoryRouter` with the full `api` module mocked to a deterministic
   empty-but-loaded fixture and snapshots the DOM. This was added alongside
   `31927e2` (the commit that introduced the route) and is part of the
   "trusted baseline" the change brief explicitly says is out of scope for
   re-verification in this pass (`0416066`..`60af828` minus the two named
   live bugs). **No new page-load test is needed or recommended** — adding
   a second one would duplicate this file's existing coverage for zero
   marginal signal. State this plainly rather than manufacturing a
   redundant spec to satisfy the letter of "add a page-load test."

2. **Cross-view parity ("does `/focus` agree with the pre-existing
   `FocusReportModal`/`FocusReportBody` on the same numbers")** — this is
   the actual, real gap the change brief names as its **top-priority
   item**: the `DERIVED-DUAL-VIEW` defect pattern (§9.1 of
   `technical-plan.md`, being catalogued by this same intake). `FocusPage`
   is now a 4th independent rendering consumer of the same `FocusReport`
   shape; nothing currently asserts it produces the *same numbers* as the
   other three from the *same fixture*. This is squarely a
   "component/page integration test" per §0's bucket (3) — a full mount of
   two real component trees (`FocusPage` and
   `FocusReportBody`/`FocusReportModal`) against one shared fixture,
   comparing DOM output — not a page-load-only smoke and not a unit test
   of either view in isolation.

---

## 2. Spec file(s) to add/update

### A. `server/__tests__/settings-export.test.js` (new)

Path/name chosen to match this project's `server/__tests__/<route-or-feature>.test.js`
convention (e.g. `focus-report-route.test.js`, `settings-cache-route.test.js`,
`data-transfer.test.js`) — one file per route/feature, no shared subfolder,
no supertest dependency (this codebase's convention is a hand-rolled `http`
helper, copied per-file rather than imported — see
`focus-report-route.test.js`'s own comment citing that rule). This is
**exactly** the file `technical-plan.md` §5/§7 item 6 names.

**Bucket:** API/contract bucket (`server/__tests__/*.test.js`, picked up by
`npm run test:server`). Chosen over a UI-level spec because the risk is
entirely in the streamed response's content/shape/validity, not in any
client-rendered surface — per the QA design guidance to prefer an
API/contract check over a full UI flow when the risk is contract, not UI.

**Skeleton** (follows `focus-report-route.test.js`'s `before`/`after`/fetch-
helper shape, and `data-transfer.test.js`'s `seedSession`-style fixture
helper):

```js
/**
 * @file Functional test for GET /api/settings/export
 * (server/routes/settings.js) — the streamed-response rewrite from 60af828.
 * Confirms the stream actually contains correct, complete data (not just
 * that the route exists — server/__tests__/api.test.js's OpenAPI coverage
 * check only proves the path is documented, never issues a real GET).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `dashboard-settings-export-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");

let server, BASE;

// Raw-body fetch (not JSON-auto-parsed) — the export route sets
// Content-Disposition: attachment, and this test needs the exact bytes to
// assert on stream validity, not just a parsed object.
function fetchRaw(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  try { db.close(); } catch { /* already closed */ }
});

function seedSession(id) { /* mirror data-transfer.test.js's seedSession:
  1 session, 2 agents (parent+child), N events, 1 token_usage row */ }

describe("GET /api/settings/export", () => {
  it("streams a valid JSON body containing every seeded row, correctly shaped", async () => {
    seedSession("exp-s1");
    seedSession("exp-s2");
    const res = await fetchRaw("/api/settings/export");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.match(res.headers["content-disposition"], /attachment; filename="agent-monitor-export-\d{4}-\d{2}-\d{2}\.json"/);

    const parsed = JSON.parse(res.body); // throws if the stream produced malformed JSON
    assert.ok(parsed.exported_at);
    assert.equal(parsed.sessions.length, 2);
    assert.equal(parsed.agents.length, 4); // 2 sessions x (1 main + 1 sub)
    assert.ok(parsed.events.length >= 2);
    assert.equal(parsed.token_usage.length, 2);
    assert.ok(Array.isArray(parsed.model_pricing) && parsed.model_pricing.length > 0);

    // Content correctness, not just counts — round-trip a known row.
    const s1 = parsed.sessions.find((s) => s.id === "exp-s1");
    assert.ok(s1);
    assert.equal(s1.status, "completed" /* whatever seedSession set */);

    // Ordering pin: route orders sessions by started_at DESC, events by
    // created_at DESC (server/routes/settings.js's two .prepare() calls) —
    // assert the streamed order matches, not just that all rows arrived.
  });

  it("streams valid, parseable JSON with empty arrays when the DB has no rows", async () => {
    // Fresh assertions against a session-free slice, or a second TEST_DB —
    // whichever is cheaper given this file's before/after — must still
    // produce `"sessions":[]` not `"sessions":[,]` or unterminated JSON
    // (the first/comma bookkeeping in writeJsonArray is exactly the kind
    // of off-by-one a functional test needs to catch that a route-existence
    // check cannot).
  });

  it("large export streams without blocking or truncating (yield-every-500 boundary)", async () => {
    // Optional/stretch: seed just over EXPORT_YIELD_EVERY (500) events for
    // one session, assert the full count still arrives intact across the
    // setImmediate yield boundary. Cheap to add given the fixture is
    // already event-seeding; skip if it meaningfully slows the suite.
  });
});
```

**Tag:** none (no tagging convention exists in this project — see §0).
Picked up automatically by `npm run test:server`'s glob
(`node --test server/__tests__/*.test.js`).

**Serial or parallel:** no special requirement — follows this file's own
isolated temp-DB-per-file pattern (`DASHBOARD_DB_PATH` set before any server
module is required), same as every other file in `server/__tests__/`. Node's
test runner already runs files in the same process sequentially by default
for this project (confirmed by the shared `node --test server/__tests__/*.test.js`
invocation used elsewhere in this repo); no new serialization concern is
introduced.

### B. `client/src/components/__tests__/FocusReportModal.test.tsx` (extend, not new)

This is **exactly the file `technical-plan.md` §5/§7 item 1 names** —
`[FocusPage extension of the standing template]`, following the file's own
established `[standing template]` (line 650) /
`[board-mode extension of the standing template]` (line 737) naming and
structure. Do not create a new file for this — the whole point of the
"extend THIS test" instruction embedded in both existing test names is to
keep every `FocusReport`-consumer parity check in one place so a future
consumer is added here too, not scattered across page-local files.

**Bucket:** component/page integration bucket
(`client/src/**/__tests__/*.test.tsx`, picked up by `npm run test:client` /
`cd client && npx vitest run`). This is the right bucket because the
assertion is fundamentally cross-component (two real trees, one fixture),
which page-load snapshot tests (bucket 2) can't express and a route test
(bucket 1, server-side) can't reach at all — the divergence risk here is
purely in client-side rendering math.

**New test to add**, immediately after line 735 (the existing
`[board-mode extension]` test), same file:

```tsx
it("[FocusPage extension of the standing template] FocusPage renders identical on-item percentage, active/idle totals, and (once zoomed to the same window) windowed totals as FocusReportModal/FocusReportBody for the same fixture — extend THIS test, not a page-local one, for any future FocusReport consumer", async () => {
  // Mirrors makeReport()'s existing fixture (reuse it directly - same
  // session/segment shape already proven correct by the two tests above).
  // Mounts FocusPage (import from "../../pages/FocusPage", per
  // FocusPage.test.tsx's own import path) alongside FocusReportModal in
  // the same test, both fed the SAME report object via the SAME
  // focusReportMock — FocusPage's api surface additionally needs
  // projects.list/sessions.list/focusReportSummary(Config) mocked and
  // ../../lib/focusStore's useFocusMap stubbed, matching
  // FocusPage.test.tsx's own vi.mock() blocks (lines ~30-58) exactly, so
  // this test doesn't have to re-derive that setup from scratch.
  //
  // Assertions (deep-equal / toBeCloseTo, not eyeballed):
  //  - on-item percentage: same value in both renders (StatTile in
  //    FocusPage vs. the stat-tile in FocusReportBody).
  //  - active_ms / idle_ms totals: same formatted string in both.
  //  - once both are zoomed to the SAME hour window via
  //    HourWindowZoomBar/useHourWindowZoom (shared hook - fireEvent.click
  //    the same zoom-preset button in both trees), the WINDOWED totals
  //    agree too - this is the assertion that specifically closes the gap
  //    FocusPage.test.tsx's current hardcoded 75%/25% assertion
  //    (~line 350) doesn't cover: a real cross-render comparison, not an
  //    independently-hardcoded expected value that could silently drift
  //    from the other view's own math.
});
```

**Tag:** none. Picked up by `npm run test:client`.

**Serial or parallel:** no special requirement.

---

## 3. Assertions summary (concrete, per spec)

**`settings-export.test.js`:**
- HTTP 200, `Content-Type: application/json`, `Content-Disposition` filename
  matches `agent-monitor-export-YYYY-MM-DD.json`.
- Response body parses as valid JSON (catches any stream-boundary/comma bug
  in `writeJsonArray`, which is exactly what a route-existence check
  cannot).
- `exported_at` present and ISO-parseable.
- Row **counts** per table match what was seeded exactly (`sessions`,
  `agents`, `events`, `token_usage`), and `model_pricing` is non-empty
  (seeded by default pricing, not by this test).
- At least one **specific field value** round-trips correctly (not just
  count) — e.g. a seeded session's `id`/`status`/`cwd` appears verbatim in
  the streamed array.
- Ordering matches the route's own `ORDER BY started_at DESC` /
  `ORDER BY created_at DESC` — pin this since it's an explicit, deliberate
  part of the route's contract, not incidental.
- Empty-DB case still yields valid, parseable JSON with `[]` arrays, not
  malformed output from the `first`-flag comma bookkeeping in
  `writeJsonArray`.

**`FocusReportModal.test.tsx`'s new `[FocusPage extension]` test:**
- Same fixture, same computed on-item percentage in both `FocusPage` and
  `FocusReportBody`/`FocusReportModal`.
- Same active_ms/idle_ms totals rendered in both.
- After zooming both to the same hour window via the shared
  `useHourWindowZoom`/`HourWindowZoomBar`, windowed totals still agree
  between the two trees — this is the specific "variant isolation holds
  across all 4 `FocusReport` consumers" assertion the change brief's
  `DERIVED-DUAL-VIEW` risk item calls for.
- No unresolved placeholder / raw JSON leaking into either rendered surface
  (standard hygiene check, not new to this test — consistent with how the
  two existing standing-template tests already assert on formatted display
  strings, not raw numbers).

---

## 4. How to run

Both are single-file runs, no separate stack needed beyond what each
suite's `before` hook already spins up (an in-process Express app on an
ephemeral port for the server test; jsdom for the client test) — no base
URL / integration-stack prerequisite beyond normal `npm run setup`.

```bash
# Settings-export functional test (server)
node --test server/__tests__/settings-export.test.js

# FocusPage cross-view parity test (client)
cd client && npx vitest run src/components/__tests__/FocusReportModal.test.tsx
```

Full-suite gate (per `technical-plan.md` §11 Definition of Done, unchanged
by this design):
```bash
npm run test:server     # must stay at-or-above 1047 passing (+N new)
cd client && npx vitest run   # must stay at-or-above 645 passing (+N new)
```

---

## 5. Cost note — what's intentionally NOT covered here

- **No new Playwright/Cypress infra is proposed.** This project doesn't
  have one, adding one is out of scope for a retroactive test-backfill
  pass (`technical-plan.md` is explicit: "not a build authorization" for
  scope beyond the six named items), and the two real gaps here are fully
  addressable at this project's existing fidelity ceiling — a real HTTP
  request against the real app for the API surface, a real component-tree
  mount for the UI surface.
- **No second `/focus` page-load test.** `screens.snapshot.test.tsx`
  already covers this (see §1.B.1) — adding a duplicate would cost CI time
  for zero new signal. Flagged explicitly rather than silently skipped.
- **Exhaustive settings-export permutations (every table's edge-case field
  values, unicode, null columns, etc.) are left to the unit layer**, i.e.
  `server/__tests__/data-transfer.test.js`'s existing round-trip suite for
  the *separate* backup/restore bundle path, plus whatever the unit
  architect adds directly against `writeJsonArray`/`getTableCounts` if
  finer-grained coverage of the streaming helper itself is wanted. This
  spec proves the wired-up HTTP flow end-to-end with a realistic multi-row
  fixture — it does not attempt to enumerate every column/table
  permutation, which would be unit-test job and unit-test cost for
  integration-test money.
- **Exhaustive `FocusReport` field coverage across all 4 consumers is left
  to the unit layer.** The new cross-view test asserts on-item percentage,
  active/idle totals, and windowed totals — the fields the change brief's
  `DERIVED-DUAL-VIEW` item specifically calls out as at-risk. It does not
  re-derive every field `FocusReportModal.test.tsx`'s many existing
  per-field unit tests already cover for a single view; extending it to
  a new field later is exactly what the test's own name instructs future
  authors to do, not something this design needs to front-load now.
- **The hour-window zoom render-cascade fix's own regression test**
  (`useHourWindowZoom.test.ts`, fake-timer assertion that `windowStartMs`
  doesn't drift between renders) is unit-layer work already assigned
  elsewhere in this intake (`technical-plan.md` §7 item 3) — not
  duplicated here, though the cross-view test above will incidentally
  exercise the fixed hook's zoomed-window code path as a side effect.
