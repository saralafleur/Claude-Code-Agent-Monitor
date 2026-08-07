# Coverage Map — plan-editing-ui (Value Pool Slice 4, Phase 4a)

> Authored by `qa-coverage-cartographer`. Maps *existing* test coverage for the
> surfaces this change touches, and records a real, just-run baseline. No new
> tests are proposed here — see the test-architect docs for that. Evaluated
> against `master` before any Phase 4a code lands (matches
> `qa/change-brief.md`'s own "nothing built yet" framing).

## Test layers this project actually has

Discovered from `package.json` scripts, not assumed:

- **Backend** — `server/__tests__/*.test.js`, Node's built-in test runner.
  Run via `npm run test:server` → `node --test server/__tests__/*.test.js`.
  No suite/tag convention (no smoke/regression split) — every file runs every
  time; scope control is per-file glob, not per-tag.
- **Frontend (component/unit)** — `client/src/**/__tests__/*.test.{ts,tsx}`,
  Vitest. Run via `npm run test:client` → `cd client && vitest run`. Includes
  a dedicated per-screen render pass, `client/src/pages/__tests__/screens.snapshot.test.tsx`.
- **i18n locale parity** — `client/src/i18n/__tests__/i18n.test.ts`, part of
  the same Vitest run (not a separate layer/command).
- **No e2e / integration-HTTP-against-a-real-server layer and no MCP layer
  applicable here.** `npm run test:mcp` exists but nothing in this change
  touches `mcp/`. Confirmed via `find` — no `*e2e*` directory in the repo.

Backend "API" tests (`server/__tests__/project-plans-api.test.js`) are not a
separate layer from "backend unit" — they run in the same `node --test`
process against an in-memory/temp SQLite DB and a real Express app instance
(no network layer), so they sit in the same suite as `plan-lifecycle.test.js`
and `single-writer-guard.test.js`.

## Existing coverage by surface

### `PlanLedgerPanel.tsx` (client component)

File: `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (1522 lines,
29 `it()` cases across two `describe` blocks, all currently green).

What exists today and is relevant to this change:
- Rendering of open plans + nested items in the left pane (generic tree
  render, not depth-indented) — `it("renders 2 open plans with their nested
  items…")`.
- The **existing, flat** claim gesture: `it("calls api.projectPlans.claim
  exactly once with (itemId, unit) and unit disappears")` — asserts against
  the current flat `openItems` `<select>`, not a hierarchy-aware one.
- `SF-8` / `SF-8 (in-flight)` — the `MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH`
  candidate pattern named in the change brief. Regression tests exist for
  `mergeCoverage`'s cross-project leak (unkeyed component, `computed_at`
  comparison) — these guard the *coverage snapshot* field, not the item
  tree/hierarchy this change touches, but confirm the pattern is live and
  tested for at least one field on this component.
- `BL-2 regression` — the `STRICTMODE-BLIND CLIENT SUITE` candidate pattern
  named in the brief. One regression test renders the panel under
  `<StrictMode>` and asserts the un-re-armed-ref bug stays fixed. Per
  `PROJECT-CONTEXT.md`'s own note, this closes **only this one component's
  known instance**; it is not a suite-wide StrictMode wrapper, so any *new*
  `useRef`/`useEffect` this change adds (add-item form, edit-in-place) is
  **not** automatically covered by it.

What does **not** exist today (confirmed by direct read/grep of the test
file and the source): no test for an add-item form, no test for edit-in-place
(text or placement), no `flattenItemTree` (function does not exist in
`PlanLedgerPanel.tsx` yet — confirmed via grep), no hierarchy-aware/depth-
indented claim `<select>`, no cross-consumer equality test between the
read-only tree and the claim picker (the brief's planned **C3**), and no
parent-picker self/descendant-exclusion test (planned **C7**). None of this
is a gap in an existing test — the feature does not exist on `master` yet.

### `POST /:id(\d+)/claims` (single-unit claim route)

File: `server/__tests__/project-plans-api.test.js`, `describe("Group D:
claims cardinality (DEC-7)")`, lines 395-557.

- **D1-D3, D5** exercise the route's ordinary success/duplicate/unclaim
  paths and are unrelated to the atomicity fix.
- **D4** (`"new_item inline form is atomic — failure leaves neither claim nor
  item created"`, lines 494-523) is the test the change brief names for
  rewrite. Read directly: its failure case is `new_item: { text: "" }`,
  which `insertProjectPlanItem` rejects with `INVALID_INPUT` **before any
  write happens** (`plan-lifecycle.js:134`, checked before the
  `insertProjectPlanItem.run(...)` call). The assertion that follows (item
  count unchanged) is true, but it is true for a reason unrelated to
  transactional atomicity — no write was ever attempted, so nothing was
  ever rolled back. **This is a live, named instance of this project's own
  §9.3 VACUOUS-GUARD / "NAME-OVERCLAIMING GUARD" sub-shape**: a real,
  passing assertion whose title ("atomic") is a superset of what it
  actually checks. The route handler itself has **no
  `dbModule.db.transaction(...)` anywhere** (confirmed by grep, matches the
  change brief's own verification note) — so the *real* failure mode this
  test's name promises to guard (claim insert fails after item insert
  succeeds, e.g. a `UNIQUE` collision on the newly created item) is
  completely unexercised today. D4 is **PASSING and UNGUARDED** for its own
  stated purpose.

### `PATCH /items/:itemId`

File: `server/__tests__/project-plans-api.test.js`, `describe("Group B: item
CRUD on open plans")`, lines 219-295.

- **B1** covers `parent_item_id` only at **creation** time (`POST
  .../items`), not via `PATCH`.
- **B2** patches only `text` and asserts read-back; no test patches
  `position`, and **no test anywhere patches `parent_item_id` via `PATCH
  /items/:itemId`** (confirmed by grep across `server/__tests__/*.test.js`
  for `parent_item_id` near a `patch(` call — zero hits). This matches the
  change brief's own verification: `updateProjectPlanItem` destructures only
  `{ text, acceptance, detail, checked, position }` (`plan-lifecycle.js:162`)
  and has no `parent_item_id` handling to test yet.
- **B3** covers 404/400 negatives, none touching re-parenting.

### `plan-lifecycle.js` (domain module)

Two files touch this module today:

1. `server/__tests__/plan-lifecycle.test.js` (157 lines, 19 `it()` cases,
   labelled "A2.1"-"A2.19"). **Read in full: the large majority of these
   cases are existence-only assertions** — `assert.ok(typeof
   planLifecycle.closePlan === "function")` (A2.4, A2.5, A2.6, A2.17, A2.18),
   `assert.ok(typeof planLifecycle.insertProjectPlanItem === "function")`
   (A2.8), `assert.ok(typeof planLifecycle === "object")` (A2.11, A2.12),
   etc. — not behavioral assertions against seeded state. A handful are real
   structural/schema checks (A2.2 PRAGMA column-set, A2.7/A2.13 grep-based
   negative-existence scans, A2.14 PRAGMA on `value_claims`, A2.16 grep for
   `UPDATE value_claims`). **This file is effectively a skeleton the plan
   inherited from an earlier phase, not a behavioral suite** — it would not
   catch a regression in `closePlan`, `insertProjectPlanItem`, or claim
   lifecycle behavior; it only catches the named export disappearing or two
   specific schema/text-grep facts changing. Treat this file's ticks as
   **PARTIAL at best** for anything beyond the schema/grep checks it names
   explicitly.
2. `server/__tests__/project-plans-api.test.js` — the real behavioral
   coverage of `plan-lifecycle.js` lives here, indirectly, via HTTP-shaped
   assertions against the routes that call into it (Groups B/C/D above).

No test today covers `updateProjectPlanItem`'s `parent_item_id`
intent-detection (`Object.hasOwn`), the 4-step re-parent validation, cycle
rejection, or the new `claimUnitIntoItem` composer — none of this code
exists on `master` yet.

### `db.js`'s plan-item schema

- `server/__tests__/db-migration.test.js` covers `project_plan_items`
  schema/migration shape generally (column presence across historical
  snapshots, including `parent_item_id` as a column that must survive
  migration) but has no case for a *new* prepared statement
  (`reparentProjectPlanItem`) because it doesn't exist yet.
- `server/__tests__/plan-lifecycle.test.js` A2.2 and A2.14 are PRAGMA-based
  exact-column-set checks on `project_plans` / `value_claims` (not
  `project_plan_items`) — they would not catch an unintended schema drift on
  `project_plan_items` itself.
- `reparentProjectPlanItem` — confirmed via grep, does not exist in `db.js`
  today. No test can cover it because it isn't there.

### `client/src/lib/api.ts`

**No dedicated test file exists for `api.ts`** (confirmed: `find
client/src -iname "*api*.test.*"` returns nothing). Every component test
that touches `api.projectPlans.*` — including all of
`PlanLedgerPanel.test.tsx` — does so through `vi.mock("../../lib/api", ...)`
(confirmed at line 35), i.e. the real `updateItem` function (URL
construction, HTTP method, body shape, and its `parent_item_id` typing) is
**never exercised by any test in the client suite, direct or indirect.**
The change brief's own framing — "the existing (already-typed,
currently-lying) `parent_item_id` contract" — is accurate: the type says
`number | null` today with no server-side effect, and nothing asserts either
the old (lying) contract or would assert the new (honest) one. This is
**UNGUARDED**, not merely undertested.

## Coverage verdict per surface

| Surface | Verdict | Why |
|---|---|---|
| `PlanLedgerPanel.tsx` — existing render/claim/close paths | GUARDED | 29 passing behavioral cases, real DOM assertions |
| `PlanLedgerPanel.tsx` — hierarchy-aware picker, add-item, edit-in-place, `flattenItemTree`, C3 cross-consumer equality, C7 exclusion | UNGUARDED | code and tests both don't exist yet (expected pre-build) |
| `PlanLedgerPanel.tsx` — StrictMode double-invoke class | PARTIAL | one instance (BL-2/mountedRef) closed; the class is open per `PROJECT-CONTEXT.md`'s own candidate-pattern note — new `useEffect`s this change adds are not auto-covered |
| `POST /:id(\d+)/claims` — ordinary success/duplicate/unclaim | GUARDED | D1, D2, D3, D5 are real behavioral assertions |
| `POST /:id(\d+)/claims` — atomicity of the composite write (D4) | **UNGUARDED, despite a green, purpose-named test** | D4's failure path is caught by pre-write input validation, never exercises a rollback; §9.3 NAME-OVERCLAIMING GUARD instance, cited by the change brief itself as the change set's single highest-value invariant |
| `PATCH /items/:itemId` — `text`/`acceptance`/`detail`/`checked`/`position` | GUARDED | B2 covers `text`; B1/B3 cover creation-time validation; existing 5-field COALESCE path is exercised indirectly |
| `PATCH /items/:itemId` — `parent_item_id` (re-parent) | UNGUARDED | zero test patches this field via PATCH; field is currently a documented no-op with nothing asserting even that |
| `plan-lifecycle.js` — `closePlan`, `insertProjectPlanItem`, claim lifecycle (existing behavior) | PARTIAL | `plan-lifecycle.test.js`'s A2 series is mostly existence-only; real behavioral coverage lives one layer up in `project-plans-api.test.js`'s HTTP-shaped tests, which do cover this |
| `plan-lifecycle.js` — planned `claimUnitIntoItem`, re-parent validation | UNGUARDED | does not exist yet |
| `db.js`'s plan-item schema — existing columns incl. `parent_item_id` | GUARDED | `db-migration.test.js` covers migration/column-presence |
| `db.js` — planned `reparentProjectPlanItem` statement | UNGUARDED | does not exist yet |
| `client/src/lib/api.ts` — `updateItem` (real fetch call, `parent_item_id` contract) | **UNGUARDED** | no dedicated test file; every consumer test mocks the module wholesale |
| Locale parity for new `planLedger.*` keys | GUARDED (mechanically, once keys are added) | `i18n.test.ts` E1.1 derives its namespace list from the filesystem and its key set from `en`'s JSON — a `planLedger.*` block missing from ko/vi/zh will fail E1.1 automatically; no hand-typed key list to keep in sync |
| Single-writer guards for `insertValueClaim` (planned G-A) and `project_plan_items` writers (planned G-B) | UNGUARDED today | no existing test in `single-writer-guard.test.js` scans either function name (confirmed by grep — only `upsertPlanItem`, `upsertValueUnitSummary`, `insertValueSummaryGeneration`, etc. are covered; `insertValueClaim`/`insertProjectPlanItem` are not) |

## Registry/consistency gap check

This project's `PROJECT-CONTEXT.md` names two live registry-shaped
mechanisms relevant here:

1. **`assertSingleHome` / hand-scoped structural scans (§9.7).** The planned
   G-A (`insertValueClaim` single call site) and G-B
   (`insertProjectPlanItem` writers) guards are new single-writer scans, the
   exact shape §9.7 has flagged six times for scope drift. The change brief
   already surfaces the live premise-drift itself: `insertProjectPlanItem.run(`
   has **two** production call sites today (`plan-lifecycle.js:141`, the
   canonical path, and `:269`, inside `importLegacyPlan`'s `doImport`) —
   confirmed independently by this pass via grep, matching the brief's own
   spot-check. If G-B is written as "exactly one lexical call site" per
   `technical-plan.md` §5 literally, **it goes red on day one for a reason
   unrelated to the re-parent capability it exists to guard** — per §9.3's
   history ("a guard that goes red for a legitimate reason on day one gets
   weakened, not fixed"), this needs a named, dated
   `GRANDFATHERED_QUERIES`/`FILE_DISPOSITIONS`-style exception for the
   `importLegacyPlan` site *before* G-B is written, not after. This QA pass
   independently reproduces the same finding the change brief's own
   verification notes already made — recorded here as confirmation from a
   second read, not a new finding.
2. **i18n whole-namespace parity (E1.1), confirmed working and registry-derived** —
   see above. No gap here; flagged only because the change brief lists
   locale parity as a variant class in scope and this pass verifies the
   registry mechanism that will actually enforce it is real, not aspirational.
3. **No other named registry (e.g. `CONSUMERS` in `value-ledger.js`,
   `STATE_TO_LOCALE_KEY`, `UNCOMPARED_FIELD_GUARANTORS`) is touched by this
   change's surface list** — `flattenItemTree` is a new projection of
   `buildItemTree`'s output, not a new entry in any of those existing
   registries, so none of those registries need a new row for Phase 4a.

## Current baseline (run 2026-08-06, on `master`, before any Phase 4a code)

Both suites relevant to the touched surfaces were run in full (targeted
per-file runs were not necessary — both complete in about a minute combined
and neither requires an external service):

```
npm run test:server
# → node --test server/__tests__/*.test.js
# tests 1787
# suites 444
# pass 1787
# fail 0
# cancelled 0
# skipped 0
# duration_ms 62979
```

```
npm run test:client
# → cd client && vitest run
# Test Files  61 passed (61)
# Tests  822 passed (822)
# Duration  6.70s
```

**Baseline: fully green, both layers — 1787/1787 server, 822/822 client.**
No skips, no external services required (server suite uses a temp SQLite DB
per the project's existing test harness; client suite mocks `api.ts`
wholesale in component tests). This is the "starts green" state the
technical plan's D4 rewrite, new P1-P7, G-A/G-B, and C1-C7 all need to land
against without breaking any of the above 2609 passing cases.

One test's stderr output during the client run
(`PlanLedgerPanel.test.tsx`'s `SF-9` case, which deliberately triggers a
mocked 500 from `GET /coverage` and asserts graceful degradation) is
expected console noise from the test's own negative-path assertion, not a
failure — the run still reports 822/822 passed, 0 failed.

## Conventions in play (for the test architects)

- **Backend module tests**: one file per module/route-group under
  `server/__tests__/`, named after the module (`plan-lifecycle.test.js`,
  `project-plans-api.test.js`, `single-writer-guard.test.js`). New P1-P7
  cases belong in `plan-lifecycle.test.js`; new D4/D4b in
  `project-plans-api.test.js`'s existing "Group D" describe block; new G-A/
  G-B in `single-writer-guard.test.js`, following its existing
  `it("<name> has exactly one call site — <file>")` / `it("<name>'s exports
  have an explicit disposition at every consumer")` phrasing convention
  (see lines 64, 236, 400 for the two live shapes).
- **Client component tests**: one file per component under
  `client/src/components/__tests__/`, `Component.test.tsx`. New C1-C7 belong
  in the existing `PlanLedgerPanel.test.tsx`, whose existing `it()` naming
  convention encodes a short case id in the title (`"D1: …"`, `"C1: …"`,
  `"SF-8: …"`) — the plan's own C1-C7 ids match this convention already.
- **Cross-consumer / cross-render tests** (C3 specifically) have no separate
  home in this project's layout — per `PROJECT-CONTEXT.md`'s §9.1 note, the
  one-spec-file-per-module convention gives this shape "no home" unless it
  is named as an explicit case inside the single component's own spec file,
  which is what the plan does (C3 living in `PlanLedgerPanel.test.tsx`) and
  is the correct choice per that note's own recommendation.
- **i18n**: locale JSON lives at
  `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`; no new test
  file needed for the new `planLedger.*` keys — E1.1 in the existing
  `i18n.test.ts` covers them automatically once added to all four files in
  the same commit.
- **Snapshot layer**: `client/src/pages/__tests__/screens.snapshot.test.tsx`
  already has `PlanLedgerPanel`-specific handling (deterministic fixture
  setup, noted at line ~531). Per this project's own testing policy, this
  needs a *reviewed*, not blind, `npx vitest run -u` regeneration once the
  DOM changes land — never treat a snapshot diff as something to
  auto-accept.
