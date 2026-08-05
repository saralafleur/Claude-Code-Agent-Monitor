# Coverage Map — value-summary-tick

> Authored by `qa-coverage-cartographer`. Maps *existing* test coverage for
> every surface `technical-plan.md` touches, and records a real, just-run
> green/red baseline. No new tests are proposed here.

**Grounded against:** `intake/2026-08-04-value-summary-tick/qa/change-brief.md`,
`intake/2026-08-04-value-summary-tick/technical-plan.md`, `PROJECT-CONTEXT.md`
(repo topology + defect catalog §9.1-§9.7), and direct reads of the live test
files listed below. Confirmed on disk: as of this pass, neither
`server/lib/value-summary-tick.js` nor
`server/__tests__/value-summary-tick.test.js` exists — everything below
describes coverage of the **already-shipped** three-altitude layer (`b155f83`
on `master`) that this build extends, not of the tick itself (which has zero
coverage because it has zero code).

## 0. Test-stack layers this project actually has

Discovered from `package.json` + directory layout (no `PROJECT-CONTEXT.md`
test-stack section, so derived directly):

| Layer | Command | Convention |
|---|---|---|
| Server unit/integration (single layer — no split) | `npm run test:server` → `node --test server/__tests__/*.test.js` | One spec file per module/surface, `node:test` + `node:assert/strict`; structural/guard specs (`*-guard.test.js`, `chronology-ordering.test.js`) live alongside behavioral specs, no separate directory or tag |
| Client component/unit | `npm run test:client` → `cd client && npm test` (`vitest run`) | One spec file per component under `__tests__/` next to the component; `screens.snapshot.test.tsx` is a per-screen render-snapshot suite |
| MCP | `npm run mcp:typecheck`, `npm run mcp:build` | N/A to this change — no MCP surface touched (technical plan §4 step 18 states this explicitly) |

**No e2e/Playwright layer, no separate "integration" bucket, no smoke/regression
tag convention** — confirmed by `find` for `*e2e*`/`playwright*` (none) and by
`package.json`'s two flat `test`/`test:*` scripts. This project's closest
analog to an "integration" layer is the server suite itself, which frequently
boots a real in-process Express server + real SQLite temp DB + occasionally a
real spawned `ccam` CLI child process (e.g. `ledger-metrics-parity.test.js`) —
not a separate command or directory.

## 1-2. Existing coverage by surface, with verdict

### Surface: `POST /api/project-plans/altitudes` (response gains `states`)

**Server** — `server/__tests__/value-summary.test.js`, `describe("POST
/api/project-plans/altitudes")` (lines 284-332), 3 cases:
- `"400s without project_id or units[]"` (286)
- `"returns altitudes for a valid batch and silently drops malformed entries"` (292)
- `"200s with an empty altitudes map when the LLM path is off"` (321)

**Client** — none directly (no dedicated `api.ts` test file exists at all —
see §3 below); indirectly exercised through `PlanLedgerPanel.test.tsx`'s
mocked `api.projectPlans.altitudes`.

**Verdict: PARTIAL.** The route's ≤40 synchronous cap, validation, and
"LLM-off → empty map" behavior are guarded today. The new `states` field
(additive) and the >40-unit fast-path-plus-overflow interaction (AC-1's core
regression risk) are **UNGUARDED** — no existing test posts more than one unit
or asserts anything about a partial/overflowing batch. `technical-plan.md`
step 4 names this exact gap ("a new assertion confirms `states` is present
and that a >40-unit POST returns `queued` entries for the overflow while
still resolving the first 40 inline") as work still to be written.

### Surface: `enrichPoolAltitudes` (composer — return-shape change, two invokers)

**Server** — `server/__tests__/value-summary.test.js`, `describe("enrichPoolAltitudes
caching")` (lines 193-282), 5 cases, all calling `enrichPoolAltitudes` directly
and consuming its return value as today's flat map:
- `"returns an empty map for an empty batch without touching the LLM path"` (194)
- `"generates once, then serves the cache with zero further spawns"` (201)
- `"batches multiple misses into exactly one spawn"` (225)
- `"spawns with DASHBOARD_VALUE_SUMMARY_MODEL when set and records it as the stored model"` (250)
- `"leaves a unit out of the result for a non-llm mode, a failed probe, and unparsable output"` (268)

**Verdict: GUARDED today, for the *current* return shape.** Caching (unitKey
keyed, no digest gating), single-spawn batching, model-selection plumbing, and
the "LLM off / probe fail / unparsable → absent" contract are all real,
non-vacuous assertions (deepEqual on concrete objects, spawn-count counters).
**These 5 tests will hard-break the moment DEC-10 lands** (see §4 below for
exactly why) — that is expected, unavoidable breakage the build must account
for, not a coverage gap.

The *second* invoker (the tick) calling this same composer, and the DEC-11
truth table's `queued` vs. `unavailable` split specifically, is **UNGUARDED**
— today's 5 tests only ever see one caller and only ever see the collapsed
"absent" outcome, never a distinguished miss-type.

### Surface: New background service — `value-summary-tick.js` (net-new)

**Server** — **no file exists, so no test exists.** `find` and `grep` both
confirm `server/lib/value-summary-tick.js` and
`server/__tests__/value-summary-tick.test.js` are absent from the tree.

**Verdict: UNGUARDED (total).** This is expected — the change brief itself
notes nothing has been built yet. Flagging the one non-obvious part: the
*shape* of coverage this file will need has **no precedent to lean on** in
this codebase for its scheduling closure specifically. Both of this repo's
existing ticks explicitly document that their `setInterval`/overlap-guard
closures are untested by design:
- `server/__tests__/focus-inference.test.js` — no test touches
  `startFocusInference`'s `setInterval`/`unref`/boot-delay registration at all;
  every test drives `inferSession`/`heuristicClassify`/`buildActivityDigest`
  etc. (the pure helpers) directly.
- `server/__tests__/reconciliation.test.js` — its own header comment states
  this explicitly: *"NOTE: startReconciliation's setInterval registration is
  untested by deliberate decision, consistent with startFocusAudit/
  startFocusInference. The tick body (reconcileCwd) is what these tests
  drive."* (lines 8-10)

So the engineer's finding cited in the task brief is confirmed by direct read:
**neither of this repo's two existing ticks has ever had its overlap-guard/
scheduling closure exercised by a test, anywhere in this codebase.**
`value-summary-tick.test.js`'s step 10 case 1 (overlap guard, provable by
mutation: remove `running`, observe two spawns) would be the **first** test
of this shape in the project, not a repeat of an existing pattern — there is
no sibling spec to copy assertions from, only the tick *body*
(`runValueSummaryTickOnce`) test shape, which the pure-helper precedent above
does support.

### Surface: Single-writer invariant (`upsertValueUnitSummary.run(`, one lexical call site, two invokers)

**Server** — `server/__tests__/single-writer-guard.test.js`, 5 `it()` blocks
(lines 44, 73, 87, 111, 194), **all scoped to a completely different write
composer** (`plan-writeback.js`'s `applyDisposition`/`appendPlanItem`/
`appendSubItem`) — nothing in this file today mentions `upsertValueUnitSummary`,
`enrichPoolAltitudes`, or `value-summary.js` at all (confirmed by direct read
and by `grep -n "upsertValueUnitSummary\|value-summary" single-writer-guard.test.js`
returning nothing).

**Verdict: UNGUARDED.** The file's `scanFiles` walker and general shape are
reusable (and the technical plan correctly directs the new guard to extend
this file rather than create a sibling), but as of today **zero** assertion
anywhere in the suite protects "exactly one lexical
`upsertValueUnitSummary.run(` call site, inside `enrichPoolAltitudes`" — the
change brief's own "single highest-value test in the whole change." This is
the project's §9.1 DERIVED-DUAL-VIEW pattern in its write-sequence form
(same shape as the `plan-writeback.js` guard this file already has, and the
same shape §9.1's 2026-08-01 build-outcome note describes being built for the
first time on a different surface) — currently unenforced here.

`server/__tests__/helpers/single-home.js`'s `assertSingleHome` (used today by
`git-refs.test.js`, `plan-import-inversion.test.js`, `value-ledger.test.js`,
**not yet** by `single-writer-guard.test.js`) is the correct, existing,
derived-scope helper the plan directs reuse of — confirmed present and
working (derives scope from `Object.keys(require(sharedModulePath))`, per
§9.7's cure). Reusing it for `value-summary.js`'s exports (step 9.4) is a new
call site of an existing helper, not a new helper — consistent with DEC-6/§9.7.

### Surface: Pool-membership single-composer rule (`assembleValuePool`, DEC-16) + `CONSUMERS` registry

**Server** — `server/__tests__/ledger-metrics-parity.test.js`, `describe("ledger
metrics parity (C2 / T6)")`, 4 cases (C2.1-C2.4). The load-bearing one for this
change:
- **C2.4** (line 282): `assert.deepEqual(valueLedger.CONSUMERS.slice().sort(),
  ["bin/ccam.js (cmdLedger)", "server/routes/project-plans.js"].sort(), ...)`
  — a real, non-vacuous exact-array equality (would fail today if run against
  a `CONSUMERS` array that already included the tick).

**Verdict: GUARDED for its current scope, and it is a real tripwire** — a
straight `deepEqual` on a hardcoded array is exactly the kind of assertion
that will go red the moment `value-ledger.js`'s `CONSUMERS` (currently
`["server/routes/project-plans.js", "bin/ccam.js (cmdLedger)"]`, confirmed at
`server/lib/value-ledger.js:57`) gains the tick and the test's expected array
does not. **This is DEC-7's required red-before-green step, and it is
mechanically real today** — confirmed by reading the exact assertion, not
just its title. C2.1-C2.3 (API/CLI parity, null-shape parity, pool/history
parity) drive a real spawned `ccam` CLI child process against a real seeded
DB (not a stub), consistent with the project's stated "T6 must not degenerate
into mocking the CLI" requirement.

The structural half of DEC-16 (a scan asserting the tick's source contains no
`FROM project_paths`/`FROM detour_dispositions`/`detectTrunkDrift` of its own
— step 10 case 8) is **UNGUARDED** — no such scan exists yet anywhere in the
suite, for any file (this is a net-new assertion shape, not an extension of
an existing one).

### Surface: `chronology-ordering.test.js`'s `FILE_DISPOSITIONS` registry (DEC-9's target)

**Server** — `server/__tests__/chronology-ordering.test.js`. Directly confirmed
by read: `FILE_DISPOSITIONS` (line 98) already carries
`"server/lib/value-ledger.js": "scanned"` (line 149) and
`"server/lib/value-summary.js": "scanned"` (line 150) — **both already
correctly dispositioned from the prior build.** `server/lib/value-summary-tick.js`
has **no entry**, which is the correct, expected state for a file that does
not exist yet.

**Verdict: GUARDED for the scan's live scope, UNGUARDED for the tick file
(correctly, pending its creation).** The scan's scope-derivation (every direct
`.js` child of `server/lib/`/`server/routes/` + `server/db.js`) is real and
will pick up `value-summary-tick.js` automatically the moment the file lands,
per DEC-9. QA should re-verify at build time (per the technical plan's own
step 8) that the suite is observed to fail with the literal
`"server/lib/value-summary-tick.js has no disposition in FILE_DISPOSITIONS"`
message **before** the disposition entry is added — this pass did not modify
the tree, so that red observation is still owed to whoever builds step 8.

### Surface: Plan Ledger panel altitude rendering (`PlanLedgerPanel.tsx`)

**Client** — `client/src/components/__tests__/PlanLedgerPanel.test.tsx`, 11
tests total, 3 altitude-specific (confirmed matches the brief's count):
- `"shows a generating placeholder for Project/Stakeholder before altitudes
  resolve, then the resolved text"` (370)
- `"shows an unavailable placeholder when a unit is missing from the altitudes
  response"` (411)
- `"requests altitudes exactly once for a stable unit set (no re-request on an
  unrelated re-render)"` (428)

**Verdict: GUARDED for today's two-state contract** (`undefined`/generating
vs. resolved vs. collapsed-absent-→-unavailable), real assertions (`getByText`
on rendered copy, `toHaveBeenCalledTimes`/`toHaveBeenCalledWith` on the mocked
API). **UNGUARDED for the third state (`queued`)** — no test in this file
renders or asserts `queued` copy, and no test posts a >40-unit batch. AC-2's
same-render distinguishability requirement ("Queued" and "Not available" both
visible in one render) is wholly new coverage per the technical plan's own
step 14 test list — nothing today exercises more than one non-resolved unit
at a time.

### Surface: `client/src/lib/api.ts`'s `altitudes()` wrapper

**Client** — **no dedicated test file for `api.ts` exists.** Confirmed by
`find client -iname "api.test.*"` (no match) and by
`grep -rl "projectPlans.altitudes" client/src --include="*.test.ts*"`
returning only `PlanLedgerPanel.test.tsx`, which **mocks the entire `../../lib/api`
module** (`vi.mock("../../lib/api", ...)`, line 31) — so the real
`request<...>(...)` call, URL, body shape, and response-type contract inside
`api.ts`'s `altitudes()` function are never exercised by any test; only the
*consumer's* reaction to a hand-shaped mock response is.

**Verdict: UNGUARDED.** This is a pre-existing gap, not something this build
introduces — `api.ts` has no unit-test layer anywhere in this project (no
`client/src/lib/__tests__/api.test.ts` exists for any of its other route
wrappers either). Adding `states?: Record<string, "queued" | "unavailable">`
to the response type is a compile-time-only change with **zero runtime test
coverage before or after**, on either side of this build.

## 3. Registry/consistency gap check

This project has (at least) five mechanically-enforced canonical registries
per `technical-plan.md` §5, three of which this change touches directly:

1. **`value-ledger.js`'s `CONSUMERS`** — see C2.4 above. **GUARDED**, real
   tripwire, confirmed by reading the assertion.
2. **`upsertValueUnitSummary.run(` single-writer site** — see §2 above.
   **UNGUARDED today.** No entry names this composer in
   `single-writer-guard.test.js` (§9.1 DERIVED-DUAL-VIEW's write-sequence
   form, defect-catalog §9.1, currently 6 recorded touches — this would be the
   surface's first guard, not a recurrence).
3. **`chronology-ordering.test.js`'s `FILE_DISPOSITIONS`** — see §2 above.
   **GUARDED for its live scope**, correctly silent on the not-yet-existing
   tick file.
4. **The `en` i18n namespace as key registry** (`i18n.test.ts` E1.1) — not
   read in this pass in full, but `technical-plan.md` step 13 explicitly
   invokes it as the derivation source for the new `queued` key across all 4
   locales; the change brief and technical plan both note this is the
   project's own §9.7-cure pattern and that a prior build (2026-08-03) shipped
   two **empty-body** `it()` cases here as a live §9.3 VACUOUS-GUARD instance.
   **Worth a direct build-time re-check that E1.1 is a real, non-empty
   assertion before trusting it as this build's i18n parity guard** — this
   pass did not re-verify `i18n.test.ts`'s current body, only confirmed the
   catalog's own warning about it exists.
5. **`WSMessage`'s hand-maintained wire registry** (`types.ts`) — explicitly
   **not** mechanically enforced (WATCH-1, confirmed by the change brief: "the
   client `WSMessage` union is the hand-maintained wire registry... The
   durable scan that would make hand-maintenance unnecessary is WATCH-1,
   deliberately not this build's cost"). Any drift here is invisible to any
   test in either layer — this is a real, acknowledged, structural gap that
   pre-dates and outlives this build.

None of items 1-3 above needs a **new** registry-completeness test to be
invented — they need either extension (C2.4's array, `FILE_DISPOSITIONS`) or
first-time coverage on an existing home (`single-writer-guard.test.js`), per
the technical plan's own step numbering. Item 5 is a known, named,
consciously-unguarded registry (WATCH-1) — flag it, do not attempt to close it
inside this build's scope.

## 4. Current baseline (actually run)

**Server:** `npm run test:server` (`node --test server/__tests__/*.test.js`)

```
# tests 1583
# suites 386
# pass 1583
# fail 0
# cancelled 0
# skipped 0
# duration_ms 43718.0945
```

**GREEN — 1583/1583.** Includes all 13 `value-summary.test.js` cases, all 5
`single-writer-guard.test.js` cases, all 4 `ledger-metrics-parity.test.js`
cases (C2.4 passing against today's 2-entry `CONSUMERS`), and the full
`chronology-ordering.test.js` scan (currently green against
`FILE_DISPOSITIONS`'s live scope, which does not yet include the tick file).

**Client, targeted:** `cd client && npx vitest run
src/components/__tests__/PlanLedgerPanel.test.tsx`

```
✓ src/components/__tests__/PlanLedgerPanel.test.tsx (11 tests) 134ms
Test Files  1 passed (1)
     Tests  11 passed (11)
```

**GREEN — 11/11**, including all 3 altitude-specific cases.

**Not run:** the full `npm run test:client` (all suites, incl.
`screens.snapshot.test.tsx` and `i18n.test.ts`) — the task asked for the
targeted `PlanLedgerPanel.test.tsx` run specifically; a full client run was
out of scope for this pass but should be part of the build's own step 18
final verification, since `screens.snapshot.test.tsx` renders the Value Pool
section and could pick up incidental diffs once `queued` lands. No blocked or
unrunnable suite was encountered — both commands executed cleanly against the
current tree.

### Breakage DEC-10 will cause on landing (real, unavoidable, not a coverage gap)

`enrichPoolAltitudes` changing its return from a flat map to `{ altitudes,
states }` will break tests that consume its return value **directly** (not
through the HTTP route, which already destructures under the wire contract).
Read against the exact assertions in `value-summary.test.js`:

**Will break (5 of 13 `value-summary.test.js` tests — all in the
`"enrichPoolAltitudes caching"` describe block, because each asserts directly
on the function's return object rather than a `.altitudes` sub-key):**
1. `"returns an empty map for an empty batch without touching the LLM path"`
   (line 198): `assert.deepEqual(await enrichPoolAltitudes(dbModule, []), {})`
   — will receive `{ altitudes: {}, states: {} }`, not `{}`.
2. `"generates once, then serves the cache with zero further spawns"` (lines
   213-222): `first[u.unitKey].project` / `second[u.unitKey].stakeholder` —
   `first`/`second` become `{ altitudes, states }` objects, so `[u.unitKey]`
   is `undefined`.
3. `"batches multiple misses into exactly one spawn"` (lines 246-247):
   `result[units[0].unitKey].project` — same shape break.
4. `"spawns with DASHBOARD_VALUE_SUMMARY_MODEL when set and records it as the
   stored model"` (line 263): `result[u.unitKey].model` — same break.
5. `"leaves a unit out of the result for a non-llm mode, a failed probe, and
   unparsable output"` (lines 271/276/280): three `assert.deepEqual(await
   enrichPoolAltitudes(...), {})` calls — same break as #1, three times over.

**Will NOT break, and do not need rewriting** — the other 8
`value-summary.test.js` tests (`parseOutput` ×4, `buildPrompt` ×1, the 3 POST
route tests) never call `enrichPoolAltitudes` directly; the route tests read
`res.body.altitudes`, which stays valid since the plan makes `states` a pure
JSON-response addition alongside the unchanged `altitudes` key.

**Client — the 3 `PlanLedgerPanel.test.tsx` altitude tests do NOT need their
assertions rewritten**, and this is worth stating precisely because it is
counter to a first guess: all three mock `api.projectPlans.altitudes` to
resolve `{ altitudes: {...} }` with **no `states` key at all**. Under the
planned client code (`technical-plan.md` step 14.3:
`res.states?.[u.id] === "queued" ? "queued" : "unavailable"`), an absent
`states` object makes `res.states?.[u.id]` evaluate to `undefined`, which
falls to the `"unavailable"` branch — the same rendered outcome
(`AltitudeText`'s `unavailable` copy) these tests already assert today via
`null`. The fallback is optional-chained by design, so these 3 tests are
**forward-compatible with an unmocked `states` field** without modification.
They still need to be **re-run** post-landing to confirm this holds (the
technical plan's own language — "re-verified against the hybrid contract,"
not "rewritten" — is the accurate framing), and a 4th, genuinely new test
(the >40-unit `queued`-vs-`unavailable` same-render case, AC-2) is required
net-new, not a modification of these 3.

## 5. Conventions in play (for the test architects)

- **New server tick spec:** `server/__tests__/value-summary-tick.test.js`,
  sibling to `value-summary.test.js`, following this project's one-file-per-module
  convention (confirmed: `focus-inference.js` ↔ `focus-inference.test.js`,
  `reconciliation.js` ↔ `reconciliation.test.js`). Reuse the `fakeSpawn`/
  `envelope`/`makeProject`/`unit` helpers already in `value-summary.test.js`
  where practical (the technical plan says so explicitly) rather than
  reimplementing them — this project's own §9.1 catalog entry (5th/6th touches)
  specifically warns against a second hand-rolled copy of a helper one call
  frame from the original.
- **Single-writer guard additions:** new `it()` blocks go **inside the
  existing** `server/__tests__/single-writer-guard.test.js`, using its
  existing `scanFiles` walker plus a new call to the existing
  `assertSingleHome` (from `server/__tests__/helpers/single-home.js`) — do
  **not** create a new guard file or a new scope-derivation helper (DEC-6,
  §9.7's own standing lesson).
- **Registry extensions** (`CONSUMERS` / C2.4, `FILE_DISPOSITIONS`) are
  one-line array edits in already-existing test files, each required to be
  observed red before the corresponding production-code entry is added
  (DEC-7, DEC-9) — not new spec files.
- **Client altitude test additions** go inside the existing
  `PlanLedgerPanel.test.tsx`, in the same `describe("PlanLedgerPanel")` block,
  following its existing pattern: `mockAltitudesMock.mockResolvedValue({...})`
  → `render` → `waitFor` → `screen.getByText`/`getAllByText`.
- **Every guard this build adds must be observed red before green, by
  mutation, not by reading** — this is a standing rule in
  `PROJECT-CONTEXT.md` §9.3 (adopted 2026-08-02 after 5 same-shape vacuous
  guards shipped in one prior build), and `technical-plan.md` §6's mutation
  list already names the exact 5 injections required (rogue write call site,
  rogue log call site, omit `FILE_DISPOSITIONS` entry, omit from `CONSUMERS`,
  remove the `running` flag). A report that a mutation was run is itself
  **unverified** per §9.3's 2026-08-03 AGENT-SELF-REPORTED-RED sub-pattern —
  someone other than the implementer should re-run or read the guard body
  directly before sign-off.
