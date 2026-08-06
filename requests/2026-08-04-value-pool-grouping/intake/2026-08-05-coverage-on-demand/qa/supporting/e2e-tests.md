# E2E / integration test design — Value Pool Slice 2 (coverage-on-demand)

> Authored by `qa-e2e-architect`, scoped to the two items the orchestrator
> named: `FAST — QA debt` item A.1 ("full E2E of the coverage-request flow")
> and item A.4 ("WS subscriber lifecycle edges beyond the G2 parity
> assertion"), plus the two decisions.md rows the orchestrator tied to A.4 —
> **WATCH-S2-B** (`requestedAltitudesRef` fetch-once semantics ending) and
> **WATCH-S2-D** (a running drain occupies one passive rotation slot). Change
> under evaluation: `4c2e931` on `master`. Grounded in
> `qa/change-brief.md`, `technical-plan.md` §8, `pm-plan.md` PM-4, and
> `decisions.md` (root + `build/2026-08-05-coverage-on-demand/`).

## 0. What this project's "E2E" actually is (grounding, before design)

There is **no Playwright/Cypress/browser-automation harness** anywhere in this
repo (`find … -iname "*playwright*" -o -iname "*cypress*"` returns nothing;
`PROJECT-CONTEXT.md` names no such tool). This is a server+client SPA whose
own highest-fidelity test shape is the one `project-plans-api.test.js` and
`server/__tests__/value-coverage-parity.test.js` already use: **boot the real
Express app (`createApp`/`startServer` from `server/index.js`) against a real
throwaway SQLite file, drive it over real HTTP, and — because
`startServer` also calls `initWebSocket(server)` — a real `ws` client can
connect to the real `/ws` endpoint and receive real broadcast frames.**
Nothing in the existing suite currently opens that real `ws` client (every
existing spec injects a `broadcast` callback directly into
`runValueSummaryTickOnce`/`runCoverageDrain` instead, e.g.
`value-coverage-parity.test.js:162-169`), but the pieces are already wired
(`ws` is a normal dependency, `server/websocket.js`'s `verifyClient` allows an
unauthenticated loopback connection when no `DASHBOARD_TOKEN` is set, exactly
as `client/src/hooks/useWebSocket.ts` documents). This design proposes the
first spec in the repo to do that — it is the closest this project can get to
"open a tab and watch it update" without inventing a browser harness it
doesn't use.

On the client side, this project's "integration" layer is a Vitest + RTL
component test with the **real `eventBus` singleton** (not mocked) and only
`../lib/api` mocked — `PlanLedgerPanel.test.tsx` already does this for the R4
out-of-order and BL-2 StrictMode cases. That is the correct home for "does an
open tab visibly update without a remount" — RTL cannot open a second browser
tab, but two independently-mounted `<PlanLedgerPanel>` instances sharing the
one real `eventBus` module-singleton is a faithful proxy for two tabs, because
`eventBus` genuinely is one bus per process the way it is one bus per browser
tab in production (see the file's own header, `client/src/lib/eventBus.ts:6`).

**Bucket/tag convention finding:** this project has **no** smoke/regression
tag system and no serial-vs-parallel bucket split. `ci.yml`'s `test` job runs
`npm run test:server` (`node --test server/__tests__/*.test.js`, one file =
one isolated child process, tests inside a file run sequentially by default)
and `npm run test:client` (`vitest run`, one file = one isolated worker)
unconditionally on every push/PR — there is no separate "e2e" CI stage to
opt into or skip. The de-facto "bucket" on this project is **one named spec
file per behavioral shape**, with a **MANDATORY named-file convention for the
single most load-bearing cross-layer proof** (precedent:
`value-coverage-parity.test.js`, `ledger-metrics-parity.test.js` — "a
per-shape spec only gets written when it is given a name," `PROJECT-CONTEXT.md`
§9.1). This design follows that convention rather than inventing a tag/bucket
scheme the project doesn't have.

---

## 1. Flows to cover

1. **The full coverage-request flow, end to end, through the real HTTP route
   and a real WS frame** (closes debt A.1): flag a project via
   `POST /coverage-request` → confirm it jumps to the front of
   `listSweepTargets`'s rotation ahead of an older, never-swept passive
   project → the fire-and-forget `runCoverageDrain` the route kicked actually
   drains a multi-batch pool to 100% → a real `ws` client connected to the
   running server's `/ws` receives the `value_altitudes_updated` frames the
   drain broadcasts, ending in one with `coverage.complete === true` → a
   subsequent `GET /coverage` poll agrees byte-for-byte (modulo
   `computed_at`) with that last frame.
2. **The same lifecycle rendered client-side in one continuous mount, never
   remounted** (closes debt A.1's UI half + is the honest proof for AC-3/AC-5):
   a single `<PlanLedgerPanel>` render receives a sequence of
   `value_altitudes_updated` messages representing partial → `estimating` →
   `measured` ETA → `complete`, and the header text updates at each step
   without the component ever unmounting (proven by the initial-fetch mocks —
   `list`/`pool`/`health`/`coverage` — each being called **exactly once** for
   the whole scenario, and the coverage-header DOM node never disappearing).
3. **WS subscriber lifecycle edges** (closes debt A.4 + WATCH-S2-B):
   - **Reconnect**: a WS drop-then-reconnect (simulated via
     `eventBus.setConnected(false)` → `true`, matching what `useWebSocket`
     actually calls on close/open — `client/src/hooks/useWebSocket.ts:108-118`)
     does not tear down or duplicate the panel's `eventBus.subscribe`
     registration, and the panel resumes taking updates correctly from the very
     next broadcast after reconnect. `eventBus`'s own header documents "no
     buffering: a message published while nobody is subscribed is simply
     dropped" (`eventBus.ts:25-26`) and the panel never calls
     `eventBus.onConnection` today — so a gap during the disconnect is
     accepted, undisclosed product behavior, not something this test should
     assert gets replayed; the test's job is to prove the panel **recovers**
     on the next real message, not that it magically knows what it missed.
   - **Stale-tab merge**: the panel's own initial `GET /coverage` HTTP fetch
     resolves *after* a WS broadcast has already updated `coverage` state (a
     slow-network-on-mount race, the mirror image of the already-covered R4
     case which only exercises two WS messages). Must not let the late,
     stale initial fetch clobber the already-current WS-delivered state — this
     exercises `mergeCoverage`'s monotonic rule from the **fetch → WS**
     direction, not just WS → WS.
   - **Multiple tabs, same project**: two independently-mounted
     `<PlanLedgerPanel projectId="proj-1">` instances (both subscribed via the
     one real `eventBus` singleton) both receive and correctly render one
     broadcast for `proj-1`.
   - **Multiple tabs, different projects (isolation)**: a second panel mounted
     for a *different* `projectId` must not react to a broadcast addressed to
     the first project — proves the per-message `project_id` filter holds
     under two live subscribers, not just one.
   - **WATCH-S2-B, scoped bypass**: a message naming `unit_keys: ["A"]` clears
     `requestedAltitudesRef` (and triggers a re-fetch) for unit A only — unit B,
     untouched by any message, is never re-requested (extends the existing
     partial case at `PlanLedgerPanel.test.tsx:1209` with the *negative*
     assertion it doesn't currently make: some other unit must be provably
     **not** refetched).
4. **Drain does not starve passive rotation beyond WATCH-S2-D's named bound**
   (closes debt A.3's process half as it intersects A.1's flow, and gives
   WATCH-S2-D's promotion trigger — "passive rotation observed stalled for
   more than two consecutive ticks while a drain is active" — a structural
   proxy that can run in test time): while a multi-batch drain for project A
   is in flight/just-finished, a directly-scheduled tick for a second,
   never-swept passive project B is not left permanently skipped — the very
   next call succeeds once the drain's own single synchronous execution
   returns, bounding the stall to "one drain's own run," never "forever" or
   "until someone notices."

**Explicitly not re-covered here** (already proven at the unit/tick layer,
listed so nobody re-derives them by hand into this document — see §6):
the drain's six exit conditions (complete/error/no_progress/iteration_cap/
pool-growth/ttl — `value-summary-tick.test.js` lines 1046-1233), the
route↔broadcast coverage-object parity (`value-coverage-parity.test.js`),
`coverageSnapshot`/`estimateEta` arithmetic (`value-coverage.test.js`), and
the four-locale key parity (`i18n.test.ts`).

---

## 2. Spec files to add

### 2a. `server/__tests__/coverage-request-e2e.test.js` (NEW)

Covers flow 1 and flow 4. Named per the project's MANDATORY-deliverable
convention (§9.1's "name the file and the spec gets written" — the debt item
is literally titled "full E2E," so it gets a file whose name says so, the
same move that worked for `value-coverage-parity.test.js` and
`ledger-metrics-parity.test.js`).

**Bucket:** `server/__tests__/*.test.js`, run by `npm run test:server`
alongside every other server spec — there is no separate "e2e" bucket to
place it in (see §0). It is a normal `node --test` file, isolated in its own
child process, so the module-scope `running` overlap guard in
`value-summary-tick.js` cannot leak into any other spec file. Tests inside the
file must stay **sequential** (default `node --test` behavior — do not mark
any `it()` with `{ concurrency: true }`), because the flow depends on strict
ordering (request → drain → poll → assert) and shares one server/DB via
`before`/`after`, exactly like `value-coverage-parity.test.js`.

**Setup, reusing existing precedent/helpers verbatim:**
- `TEST_DB` temp file + `DASHBOARD_DB_PATH`, `createApp`/`startServer` from
  `../index`, teardown pattern — copy `value-coverage-parity.test.js`'s
  `before`/`after` (lines 39-90).
- Reuse `value-summary-tick.test.js`'s `__injectSpawnForTest` (from
  `../lib/focus-inference`), `__injectPoolAssemblerForTest` and
  `spawnResolvingFirst(n)` / `fakeSpawn` helpers (lines 22-138) to make
  "generation" deterministic and free — **do not** set
  `DASHBOARD_FOCUS_INFER_MODE=heuristic` for this file (heuristic mode never
  generates, so a drain can never converge past `no_progress` — the parity
  test relies on exactly that to force `generated===0`, but this flow test
  needs the opposite: real batch-by-batch progress to 100%).
- Seed a project (`makeProject`-style helper, copy the pattern from
  `value-summary-tick.test.js`'s `makeSweptProject`) whose injected pool has
  **85 units** (`makeUnits(85, …)` from the same file) — bigger than
  `MAX_UNITS_PER_PROMPT=40`, forcing **3 drain batches** (40+40+5), so the
  test genuinely exercises "drained in bounded batches," not a one-shot
  complete. Seed a second, unrelated passive project with no prior sweep
  (`lastSweptAt: null`) to prove rotation-jump and starvation-bound.
- Connect **one real `ws` client**: `const WebSocket = require("ws"); const
  client = new WebSocket(\`ws://127.0.0.1:${port}/ws\`);` in `before`,
  collecting every parsed `value_altitudes_updated` frame whose
  `data.project_id` matches the seeded project into an array. This is the
  literal thing a browser tab's `useWebSocket` hook does — the first spec in
  this repo to open one for a test.

**Scenario steps:**
1. Assert baseline: `GET /coverage?project_id=<A>` → `demand: "passive"`,
   `complete: false` (85 units, 0 described).
2. `POST /coverage-request { project_id: A }` → `202`, response
   `coverage.demand !== "passive"`.
3. Read `listSweepTargets(dbModule)` (or the equivalent exported ordering
   helper) immediately after the POST and assert project A sorts **first**,
   ahead of project B (rotation jump), reusing the ordering assertions already
   proven in isolation at `value-summary-tick.test.js:1243` but now against
   the real route's side effect, not a hand-stamped `requestValueCoverage`
   call.
4. Poll `GET /coverage?project_id=<A>` (short interval, generous timeout —
   e.g. every 25ms up to 2s, matching the existing 100ms liveness pattern in
   `project-plans-api.test.js` T3) until `complete === true` or the poll times
   out; fail loudly on timeout rather than hanging.
5. Assert the collected real-`ws` frames array is non-empty, and its **last**
   frame's `data.coverage`: `complete === true`, `pending === 0`,
   `described === pool_size === 85`, `demand === "passive"` (DEC-8/DEC-4:
   flag clears at true 100%). Assert **at least one** intermediate frame
   exists with `demand !== "passive"` (proves the header's "requested"/
   "draining" mid-flight text is reachable at all over the wire — this is the
   only place a client ever sees `demand:"draining"`, since **both HTTP routes
   hardcode `draining:false` per the build's own SF-3 finding** — assert this
   explicitly: every polled `GET /coverage` response in step 4's loop has
   `draining` absent/false even while a WS frame mid-loop shows a
   non-passive demand, pinning today's real (if imperfect) behavior rather
   than assuming it).
6. Deep-equal the last WS frame's `coverage` against the final `GET /coverage`
   poll's `coverage`, stripping `computed_at` (same technique as
   `value-coverage-parity.test.js:186-190`).
7. **Starvation bound (flow 4 / WATCH-S2-D):** immediately after step 4's
   poll observes `complete: true` (i.e., the fire-and-forget
   `runCoverageDrain` call the route kicked has returned and released the
   module-scope `running` guard), directly call
   `runValueSummaryTickOnce(dbModule, {})` for project B and assert
   `result.swept >= 1` (**not** `{skipped: "overlap"}`) — proving the guard
   released promptly and project B is not starved beyond this one drain's own
   run. Document in the test's own comment that this is a **structural
   proxy** for WATCH-S2-D's wall-clock "two consecutive ticks" bound (a real
   10-minute tick cadence cannot be waited out in a unit-speed test) — what it
   actually proves is that the guard is released the moment the drain's
   single synchronous execution ends, which is the mechanism the wall-clock
   bound depends on.

**Assertions summary:** rotation jump is real (not just documented), the
route's fire-and-forget drain genuinely reaches a real client over a real
socket, the terminal frame and the polled HTTP state agree, `draining` stays
inert on both HTTP endpoints exactly as SF-3 says today, and the shared
overlap guard does not starve an unrelated passive project past one drain's
own duration.

### 2b. `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (EXTEND — new `describe` blocks)

Covers flows 2 and 3. Extend rather than add a new file — this project's own
convention is one spec file per component, and this file already owns the
Slice-2 coverage-header `describe` block (`910` onward) plus the R4 and
WATCH-S2-B tests this design builds on directly.

**Bucket:** `client/src/**/__tests__/*.test.tsx`, run by `npm run test:client`
(`vitest run`). No serial requirement — Vitest isolates by file already, and
within this file every existing test is independent (fresh `render()`,
`vi.clearAllMocks()` in `beforeEach`); the new tests follow the same shape.

**New describe block:** `describe("PlanLedgerPanel: coverage lifecycle, one continuous mount (QA debt A.1)")`
- **Scenario:** mount once with `coverage: makeCoverage({pool_size:5, described:0, demand:"passive", eta:{state:"none"}})`
  under cold-start conditions → assert `estimating` copy renders (reuse the
  existing cold-start assertion at line ~916) → `eventBus.publish` a
  `requested`/`estimating` frame → assert header text updates → publish a
  `draining`/`measured` frame with a real `ms_remaining` → assert the ETA
  minutes string renders (reuse the measured-ETA assertion at line ~945) →
  publish a final `complete:true, demand:"passive"` frame → assert "N of N
  described" renders and no "prioritize now" button (reuse the complete-pool
  assertion at line ~978). **Load-bearing assertion the individual existing
  tests don't make:** `mockListMock`/`mockPoolMock`/`mockHealthMock`/
  `mockCoverageMock` were each called **exactly once**, for the whole
  sequence — i.e., every subsequent update came from the WS handler's
  `setCoverage`/`mergeCoverage` path, never a re-fetch/remount. This is the
  literal "watches header go partial → estimating/measured ETA → 100% without
  a remount" acceptance signal from the task brief, made concrete.

**New describe block:** `describe("PlanLedgerPanel: WS subscriber lifecycle edges (OPEN-3 debt A.4, WATCH-S2-B)")`
- **Reconnect:** mount, receive one WS update, call
  `eventBus.setConnected(false)` then `eventBus.setConnected(true)` (importing
  the real `eventBus`, matching the R4/WATCH-S2-B tests' import style at line
  1132/1210), then publish a further update and assert it still renders —
  proving the subscription (registered once in the mount effect, never torn
  down by a connection-state change, since the panel doesn't call
  `eventBus.onConnection` at all today) survives a disconnect/reconnect cycle
  without duplicating handlers (assert the header reflects the LAST message's
  value exactly, not a doubled/stale composite — a duplicate-subscription bug
  would show as the wrong final value or a thrown error from `mergeCoverage`
  being invoked twice per publish).
- **Stale-tab merge (fetch-after-WS race):** make `mockCoverageMock` return a
  promise that resolves only after a manual `publish()` of a newer-`computed_at`
  WS frame has already landed (control the timing with a manually-resolved
  promise, not a `setTimeout` race) — assert the panel ends up showing the WS
  frame's (newer) values, not the stale HTTP response's (older) ones, once the
  fetch promise finally resolves. This is `mergeCoverage`'s monotonic rule
  exercised from the **initial-fetch** call site (`PlanLedgerPanel.tsx:705`),
  which R4 (WS→WS only) does not reach.
- **Multiple tabs, same project:** `render(<PlanLedgerPanel projectId="proj-1" />)`
  twice into two separate containers; publish one `value_altitudes_updated`
  for `proj-1`; assert **both** rendered trees show the updated header.
- **Multiple tabs, isolation:** same two-mount setup, one for `proj-1` one for
  `proj-2`; publish a message for `proj-1`; assert the `proj-2` instance's
  header is unchanged (still its own initial snapshot).
- **WATCH-S2-B, scoped bypass negative case:** extend the existing test at
  line 1209 — two units A and B, both initially fetched once
  (`mockAltitudesMock` called once with both ids). Publish a message naming
  `unit_keys: ["A's id"]` only. Assert `mockAltitudesMock` is called again
  **and its argument set contains A's id but not B's** (the missing half of
  today's assertion, which only proves "not re-fetches coverage," not "does
  not over-broadly re-fetch every unit").

---

## 3. Tag

No smoke/regression tag exists on this project (see §0) — nothing to set.
Both spec files run as part of the standard, unconditional
`npm run test:server` / `npm run test:client` CI steps in
`.github/workflows/ci.yml`'s `test` job. No serial-only flag is needed:
`server/__tests__/coverage-request-e2e.test.js` is self-contained in its own
child process (module state doesn't cross files under `node --test`'s default
per-file isolation), and its own tests must simply stay in default
(sequential) execution — do not opt any case into `node:test`'s
`{ concurrency: true }`.

---

## 4. Assertions (concrete, reused where a helper/fixture already exists)

- Rotation jump is asserted against `listSweepTargets`'s real return value,
  not inferred from timing.
- The terminal WS frame and the polled `GET /coverage` response deep-equal
  (minus `computed_at`), reusing the `strip()` helper pattern from
  `value-coverage-parity.test.js:186`.
- `draining` stays `false`/absent on **every** HTTP response even while a live
  WS frame shows a non-passive `demand` — pins SF-3's documented shape rather
  than assuming a fix landed.
- No unresolved i18n key or raw placeholder reaches the rendered header at any
  point in the lifecycle sequence (extend the existing
  `/planLedger\.[a-zA-Z]/` DOM-text sweep pattern already used at line 613/873
  to the new multi-step scenario, checked after each `publish()`, not just
  once at the end).
- Variant isolation: the "multiple tabs, different projects" case is a direct,
  concrete proof that a broadcast for project A never touches project B's
  mounted state — not asserted anywhere today.
- A reloaded/regenerated value matches what was saved: the E2E spec's step 6
  (§2a) is exactly this — what a fresh `GET /coverage` reads back must match
  what was just broadcast.
- Reuse existing fixtures/page-object-equivalents rather than reinventing:
  `makeCoverage`/`makeUnit`/`mockCoverageMock` factories already in
  `PlanLedgerPanel.test.tsx`; `__injectSpawnForTest`/`__injectPoolAssemblerForTest`/
  `spawnResolvingFirst`/`makeUnits` already in `value-summary-tick.test.js`;
  the `fetch`/`post`/`makeProject` HTTP helpers already in
  `project-plans-api.test.js` or `value-coverage-parity.test.js`.

---

## 5. How to run a single spec

No base URL / external environment prerequisite — both specs boot their own
throwaway SQLite file and an ephemeral in-process HTTP+WS server on port 0
(OS-assigned), exactly like every other spec in `server/__tests__/`. No live
integration stack, Docker, or seeded shared dashboard DB is required.

```bash
# Server-side E2E flow spec (2a)
node --test server/__tests__/coverage-request-e2e.test.js

# Client-side lifecycle / WS-lifecycle-edges cases (2b) — whole file
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx

# Client-side, just the new describe blocks, while iterating:
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "coverage lifecycle"
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -t "WS subscriber lifecycle edges"
```

Full-suite equivalents (`npm run test:server`, `npm run test:client`) both
pick these up automatically via the existing glob — no config change needed.

---

## 6. Cost note — minimum set, and what stays at the unit layer

E2E here means "boot a real server/DB/socket," which is materially more
expensive per-assertion than the unit/tick-level specs this slice already
shipped (`value-summary-tick.test.js`'s exit-condition matrix,
`value-coverage.test.js`'s arithmetic, `value-coverage-parity.test.js`'s
single-seeded-state parity). This design adds **one new server file (≈8
scenario steps, one seeded flow) and two new describe blocks in one existing
client file (≈9 cases)** — deliberately not a matrix.

**Intentionally NOT re-covered here, because it is already proven cheaper at
the unit/tick layer and duplicating it here would only slow CI for no new
information:**
- All six drain exit conditions (complete/error/no_progress/iteration_cap/
  pool-growth/ttl) — `value-summary-tick.test.js` already drives each
  directly against `runCoverageDrain`, which is strictly cheaper and more
  precisely targeted than forcing each one through a real HTTP+WS round trip.
- The coverage/ETA arithmetic itself (`coverageSnapshot`/`estimateEta`'s
  branch table) — `value-coverage.test.js`'s job, not this layer's.
- Route↔broadcast object parity in the general case — already the named
  `value-coverage-parity.test.js` deliverable; §2a reuses its `strip()`
  pattern for one more concrete pairing (real route vs. real WS frame) rather
  than re-proving the general claim.
- Four-locale key parity — mechanically enforced elsewhere
  (`i18n.test.ts`), not re-derived here.
- SF-4/SF-6/SF-7/SF-8/SF-9/SF-10.2/N1/N2 — each already has a disposition in
  `decisions.md` DEC-3/WATCH rows; this design does not re-litigate them.
  (SF-3 is the one exception referenced above, and only as a **pin**, not a
  new fix-driving test — see §2a step 5's note.)
- A real haiku/sonnet LLM call anywhere — every new spec injects a fake spawn
  (`__injectSpawnForTest`) exactly like the existing tick suite; AC-6
  calibration quality is out of scope for this document (change-brief §A.5).
- `screens.snapshot.test.tsx` baselines for the new header/"prioritize now"
  control — change-brief's debt item A.2, a separate, already-named gap, not
  this document's job.
- A literal second browser tab / real multi-process browser automation — the
  two-independent-`render()`-instances-sharing-one-`eventBus` technique in
  §2b is the acknowledged, cheaper proxy; true multi-tab-process testing would
  require a framework this project does not have, for marginal additional
  confidence given `eventBus` really is a per-tab singleton in production.
