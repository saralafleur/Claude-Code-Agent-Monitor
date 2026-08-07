# QA — Value Pool Slice 4: Plan editing UI + batch group claiming

**Intake date:** 2026-08-06
**Grounded against:** `request-brief.md` (this dir), parent `request.md`,
`PROJECT-CONTEXT.md` §9.1/§9.8, `server/lib/value-groups.js` +
`server/__tests__/value-groups-api.test.js` on
`effort/2026-08-06-auto-group-proposal` (commit `72feac9`), current
`server/routes/project-plans.js` and `client/src/components/PlanLedgerPanel.tsx`
on `master`.

## Test stack (confirmed, not assumed)

- Server: `node --test server/__tests__/*.test.js` (`npm run test:server`).
  Single spec file per surface, real Express app on a temp SQLite DB, real
  HTTP requests (`fetch`/`post` helpers) — see `project-plans-api.test.js`.
  Run one file: `node --test server/__tests__/project-plans-api.test.js`.
- Client: `vitest run` via `cd client && npm test` (`npm run test:client`).
  Testing-library + jsdom — see `client/src/components/__tests__/
  PlanLedgerPanel.test.tsx`. Run one file:
  `cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx`.
- Structural guards: `server/__tests__/single-writer-guard.test.js` — source-scans
  production code for a write primitive's call sites via `scanFiles`/regex,
  not a unit test of behavior. This is the guard family this slice must extend.

## 1. How we verify done

Manual:
1. Open `PlanLedgerPanel` for a project with an open plan. Add a top-level
   item, then a sub-item under it, without navigating away from the panel.
   Edit the top-level item's text in place.
2. Open the single-unit claim picker for a pool unit; confirm the item
   list renders parent/child indentation (not a flat list) and a sub-item
   is a selectable, distinct target from its parent.
3. On the Slice-3 group-review section, approve a group, then use its new
   claim action to batch-claim into an existing item — confirm every
   `available` member lands as a claim and the group's `review_status`
   becomes `claimed`.
4. Repeat batch-claim targeting a **newly created** item/sub-item in one
   action (no separate "create item" step visible to the user).
5. Simulate the race: after a group is approved but before batch-claim is
   clicked, claim one of its members individually (or via a second
   browser tab) — confirm the batch-claim UI/response distinguishes that
   member (`already_claimed`) from the ones that land (`claimed`), rather
   than reporting a flat pass/fail.
6. Confirm the existing single-unit claim gesture (top-level item target)
   still succeeds unchanged.

Automated (must all be green before sign-off):
- `npm run test:server` — full server suite, including the new/updated
  specs below.
- `npm run test:client` — full client suite (includes
  `client/src/pages/__tests__/screens.snapshot.test.tsx`; if
  `PlanLedgerPanel`'s DOM shape changes, review the snapshot diff and
  regenerate with `cd client && npx vitest run -u` deliberately, per
  `CLAUDE.md`'s testing policy — never blind-update).
- `node --test server/__tests__/single-writer-guard.test.js` — must gain
  (not merely keep passing) an assertion naming `insertValueClaim` and the
  batch-claim call site, per the WATCH-6 gap the brief identifies.

## 2. Regression coverage — existing specs, current pass state

Discovered by grepping `server/__tests__/` and
`client/src/components/__tests__/` for the claim/item/plan surface
(commands and full `describe`/`it` inventories run live during this pass;
counts below are from that grep, not assumed):

| Spec | Surface | Relevant groups |
|---|---|---|
| `server/__tests__/project-plans-api.test.js` | plan CRUD, item CRUD, claims | Group B (item CRUD, open-plan-only), Group D (claims cardinality, DEC-7) — **D4 is the direct precedent for this slice's atomicity requirement** (asserts the *existing* single-claim `new_item` inline form leaves no orphan item when item-creation itself fails) |
| `server/__tests__/plan-lifecycle.test.js` | `insertProjectPlanItem`/`updateProjectPlanItem`/`deleteProjectPlanItem`, closed-plan rejection | item CRUD unit-level (below the route) |
| `server/__tests__/single-writer-guard.test.js` | structural: one write primitive, one call site | currently has **no entry** for `insertValueClaim` or `insertProjectPlanItem` (confirmed by the brief's own live grep; re-confirmed here) |
| `client/src/components/__tests__/PlanLedgerPanel.test.tsx` | plan pane, item tree, single-claim gesture, coverage header | "calls api.projectPlans.claim exactly once with (itemId, unit) and unit disappears" (line ~230) is the direct precedent for "single-claim keeps working unchanged" |
| `server/__tests__/value-groups-api.test.js` (branch `effort/2026-08-06-auto-group-proposal` only — **not on `master`**) | group propose/list/approve/dismiss | `TT-a`…`TT-i` §9.8 truth-table pattern (one 9-row table, one loop, exact spawn/outcome/status per row) — the reusable shape for this slice's mixed-availability truth table; `N-1`…`N-4` negative-proof pattern ("approve never touches a claim") — the shape this slice's claim route must invert (claim route DOES touch `value_claims` + `review_status`, on purpose, and the negative-proof convention says that must be pinned by an equally explicit positive assertion, not left implicit) |

Current pass state: `project-plans-api.test.js`, `plan-lifecycle.test.js`,
`single-writer-guard.test.js`, and `PlanLedgerPanel.test.tsx` all run clean
on `master` today (this slice's changes are additive to green suites, not
fixes to red ones). `value-groups-api.test.js` only exists on the
unmerged Slice-3 branch — cannot be asserted green on `master` until that
branch merges; the brief's own open question #1 (fork-from-branch vs.
wait-for-merge) governs when this suite becomes reachable for Slice 4's
own CI runs.

**Live finding, not previously logged: the existing single-claim `new_item`
path has an ordering gap D4 does not cover.** In
`server/routes/project-plans.js`'s `POST /:id(\d+)/claims` (read directly,
lines ~482-574), `new_item` insertion happens *before* `value_source`/
`attribution`/`value_ref` validation, and `insertValueClaim` runs in a bare
`try/catch` with **no `db.transaction()` wrapper**. If a caller supplies a
`new_item` whose fields are individually valid but a downstream field
(`value_source`, `attribution`) is invalid, the item is already committed
by the time the 400 is returned — an orphan item, not rolled back. D4 only
proves the item-creation-itself-fails case (`new_item: {text: ""}`), which
never reaches `insertValueClaim`. This is a pre-existing gap in the single
route, not introduced by this slice, but it is directly load-bearing here:
the batch-claim endpoint's atomicity requirement (acceptance signal #3/#4)
must not copy this pattern, and the technical plan should decide whether to
(a) fix the single route's ordering too (wrap the whole `new_item` +
validate + insert-claim sequence in one `db.transaction()`), since the
batch endpoint's shared composer is the natural place to introduce that
transaction wrapper for both callers, or (b) explicitly scope the fix to
the new batch route only and file the single-route gap as a follow-up. Flag
for the technical plan; either disposition is acceptable, silence is not.

## 3. New/updated tests required

### 3a. Server — `server/__tests__/project-plans-api.test.js` (extend Group D, or a new `Group I: batch claims`)

Reuse the file's existing `post`/`fetch` helpers and fixture-project
pattern. Needs a Slice-3 `value_groups`/`value_group_members` fixture,
which does not exist in this file today — either import/adapt
`value-groups-api.test.js`'s `seedProjectWithCoverage` helper (once that
branch is available to fork from) or build a minimal local seed (insert a
`value_group_runs` row `state='completed'`, a `value_groups` row
`review_status='approved'`, and `value_group_members` rows referencing real
pool units) — do not hand-roll a second copy of the group-seeding logic if
the Slice-3 file is reachable (§9.1).

- **I1 (atomicity, all-available case):** batch-claim an approved group
  where every member is currently `available` into an existing item.
  Assert: all members land as `value_claims` rows in one call, response
  reports every member `claimed`, and `value_groups.review_status`
  transitions to `claimed` in the same request.
- **I2 (atomicity, all-or-nothing on infra failure):** inject a failure
  mid-batch (e.g. a duplicate-claim-triggering fixture, or a mocked
  `insertValueClaim` throwing on the Nth member) and assert **nothing**
  commits — no partial `value_claims` rows, `review_status` unchanged from
  `approved`. This is the executable proof for acceptance signal #3
  ("either all eligible members land, or none do") — must red-prove by
  actually breaking the transaction boundary once (temporarily remove the
  `db.transaction()` wrapper) and observing this test fail, matching
  §9.3 VACUOUS-GUARD's mutation-proof requirement referenced in the brief.
- **I3 (mixed availability, §9.8 truth table — model directly on
  `value-groups-api.test.js`'s `TT [M]` single-table pattern):** one group
  with three members in three different availability states
  (`already_claimed` because claimed individually between approval and
  batch-claim, `available`, `no_longer_in_pool` because e.g. its source
  detour was superseded) batch-claimed in one call. Assert the response's
  per-member outcome is a **discriminated value per member id** — at
  minimum `claimed` / `skipped_already_claimed` / `skipped_no_longer_in_pool`
  — never a single boolean, and that the `available` member's claim
  actually landed in `value_claims` while the other two did not produce
  claim rows. Prove "every member lands in exactly one outcome bucket,
  never zero, never two" explicitly (§9.8's own acceptance criterion),
  not just eyeball three green assertions.
- **I4 (zero-claimable group, the OVERLOADED-ABSENCE trap named in the
  brief):** a group where **every** member is `already_claimed` or
  `no_longer_in_pool` (zero `available`). Assert this is a **named,
  distinguishable outcome** on the wire (e.g.
  `outcome: "no_claimable_members"`), not a silent 201 with an empty
  claims array and not a generic error — the exact "group with no members
  resolved" case the parent request's own Constraints section names by
  name as this surface's standing trap. Assert `review_status` does *not*
  advance to `claimed` in this case (nothing was actually claimed) —
  decide explicitly (and pin with a test either way) whether it should
  stay `approved` or move to a distinct terminal state; do not leave this
  implicit.
- **I5 (create-new-item-then-claim, atomic, reusing inline `new_item`
  shape):** batch-claim a group with an inline `new_item` (or
  `new_item` + `parent_item_id` for a sub-item) instead of an existing
  `item_id`. Assert exactly one item is created regardless of member
  count (not one item per member), all `available` members claim into it,
  and — mirroring I2 — a downstream failure after item creation leaves
  **no orphan item**, closing the ordering gap identified in §2 above for
  this new path at minimum (whether the single-claim route also gets this
  fix is the technical-plan's call, but the batch route must not ship with
  the same gap on day one).
- **I6 (live re-check, not stale snapshot):** approve a group, then —
  before calling batch-claim — claim one member individually via the
  existing `POST /:id/claims` route (simulating "someone else claimed a
  group member out from under a pending batch-claim"). Call batch-claim and
  assert it reads live availability at claim time (via a fresh
  `resolveMemberAvailability`-equivalent call, not Slice 3's
  group-approval-time cache) and reports that member
  `skipped_already_claimed` — this is the brief's own named regression
  test for the race it flags. Directly exercises the "mixed availability
  at claim time" question the brief raises as open.
- **I7 (plan-closed guard):** batch-claim against a `closed` plan → 409
  `ALREADY_CLOSED`, matching the existing single-claim route's guard
  (`project-plans-api.test.js` Group C3's "full refusal sweep" pattern) —
  extend that sweep to include the new route rather than leaving it
  untested by the existing negative-sweep test.
- **I8 (route-level negative proof, mirroring Slice 3's N-1…N-4):** approve
  and dismiss continue to touch **only** `review_status`/`reviewed_at`
  (unchanged from Slice 3) — batch-claim is the **only** route that writes
  `value_claims` AND `review_status='claimed'` together. Worth one explicit
  assertion pinning this split now that a route exists that legitimately
  crosses the fence Slice 3's own code comment named ("AC-5 … PO §7/§8
  fence").

### 3b. Server — `server/__tests__/single-writer-guard.test.js` (new guard entries)

- **New assertion: `insertValueClaim.run(` has exactly two lexical call
  sites** — the existing single-claim route and the new batch-claim
  route/shared composer — and **both route through one shared function**
  (loop the single-claim logic inside one transaction, or a shared
  `claimUnitIntoItem`-style helper both call), per the brief's WATCH-6
  framing. If the technical plan extracts a shared composer (recommended),
  assert `insertValueClaim.run(` has exactly **one** lexical call site
  (inside that composer) and the composer itself has exactly two callers
  (single-claim route, batch-claim route) — the stronger, preferred form,
  matching this guard file's existing "exactly one call site" idiom (see
  `upsertPlanItem`, `markValueUnitSummariesSeen`, `requestValueCoverage`
  entries in the same file).
- **New assertion: `setValueGroupReviewStatus.run("claimed", ...)` has
  exactly one call site** (the batch-claim route/composer) — Slice 3's own
  schema comment reserves `'claimed'` for this slice; this guard is the
  executable proof that reservation is honored by exactly one writer, the
  same shape as this file's existing `markValueUnitSummariesSeen`/
  `requestValueCoverage` "one lexical call site" entries.
- Mutation-prove both new guards once each (temporarily add a second
  `insertValueClaim.run(...)` call site / a second `'claimed'` write) and
  confirm the guard fails — required by §9.3 VACUOUS-GUARD, cited by name
  in the brief's own Known-variant relevance section for this exact guard.

### 3c. Client — `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (extend)

- **Add-item / edit-item affordances:** rendering an "add item" control
  inside `PlanSection`, submitting text creates the item via
  `api.projectPlans.*` (name the actual call once the technical plan picks
  it — likely a new `api.projectPlans.createItem`/`updateItem` wrapper
  around the already-existing `POST /:id/items` / `PATCH /items/:itemId`
  routes) and the new item appears in the tree without a full remount.
  Cover both a top-level add and a sub-item add (target `parent_item_id`).
  Edit: change existing item text in place, assert the PATCH payload and
  the rendered text update.
- **Hierarchy-aware picker reuses `buildItemTree` (§9.1 DERIVED-DUAL-VIEW,
  named explicitly in the brief):** a structural/behavioral test that the
  claim-target `<select>`'s option list is derived from the *same*
  `buildItemTree(items)` output the read-only `ItemTree` consumes — not a
  second nesting walk. Concretely: construct a 3-level item fixture
  (parent → child → grandchild, if the schema allows arbitrary depth, else
  parent → child), assert the picker renders visible indentation/prefix
  distinguishing each depth, and assert changing `buildItemTree`'s output
  (e.g. via a reorder) changes the picker's rendered order identically to
  `ItemTree`'s — the "same field, same value, across every consumer" test
  §9.1 requires, not eyeballing two components.
- **Single-claim gesture regression (must not change):** the existing
  "calls api.projectPlans.claim exactly once with (itemId, unit) and unit
  disappears" test (line ~230) must keep passing unmodified in assertion
  shape; add a sibling case targeting a **sub-item** id specifically
  (Live verification #3 confirms `openItems` already includes sub-items
  data-wise — this test proves the *rendering* now shows it distinguishably
  and the claim call still fires with the sub-item's real id).
- **Group batch-claim button states (new):** for an approved Slice-3
  group rendered in the group-review section, a new claim control (mirror
  the existing `data-test="group-approve-button"`/
  `data-test="group-dismiss-button"` convention with e.g.
  `data-test="group-claim-button"`) — assert:
  - disabled/absent for a `proposed` (not yet approved) group,
  - enabled for an `approved` group with `member_availability_counts.available > 0`,
  - disabled (or a distinct "nothing to claim" affordance) for an approved
    group whose `member_availability_counts` shows zero `available` —
    this is the client-side mirror of server test I4, and must render a
    **named** state, not just a disabled button with no explanation (§9.8
    applies to the UI layer too, not only the wire shape).
  - clicking it opens/uses the same hierarchy-aware picker as the
    single-claim gesture (reuse, not a second picker implementation).
  - on a response containing mixed per-member outcomes, the UI renders the
    partial-skip information (e.g. "2 claimed, 1 already claimed") rather
    than a flat success toast — the client-side consumer of I3's
    discriminated response.
- **Snapshot regeneration:** if `PlanLedgerPanel`'s DOM structure changes
  materially, `client/src/pages/__tests__/screens.snapshot.test.tsx` will
  fail; regenerate deliberately (`cd client && npx vitest run -u`) and
  review the diff, per house policy — do not blind-update.

## 4. Test data / fixtures

- **Item hierarchy fixture:** an open plan with ≥1 top-level item and
  ≥1 sub-item (`parent_item_id` set) — reuse `project-plans-api.test.js`
  Group B's existing "B1: create with parent_item_id nesting + position"
  seeding pattern rather than hand-rolling a new one.
- **Group fixture (server):** once Slice 3's schema is reachable (branch
  fork or post-merge) — a `value_group_runs` row in a terminal state, a
  `value_groups` row with `review_status='approved'`, and
  `value_group_members` rows whose `(value_source, value_ref)` pairs match
  real seeded pool units (mirror
  `value-groups-api.test.js`'s `seedProjectWithCoverage`/
  `defaultUnitKeysFor` helpers — do not re-derive `unitKey` construction by
  hand, per that file's own header warning).
- **Mixed-availability fixture:** the same group fixture above, with one
  member additionally claimed via a real `POST /:id/claims` call before
  the batch-claim test runs (produces a genuine `already_claimed` state,
  not a faked DB row — matches this project's "construct real prior state,
  never fake the gate" convention seen throughout `value-groups-api.test.js`'s
  TT rows), and one member's underlying detour/source row deleted or
  altered so it no longer appears in `assembleValuePool`'s live units
  (produces a genuine `no_longer_in_pool` state).
- **Client fixtures:** extend `PlanLedgerPanel.test.tsx`'s existing
  `openPlans`/pool-unit mock builders with a 3-level item tree and a mock
  `groups` array (Slice-3 shape: `{id, review_status, members: [...],
  member_availability_counts: {...}}`) — reuse the branch's own client
  test fixtures for the group-review section shape if that spec file is
  reachable, rather than inventing a second shape.

## 5. Definition of Done checklist

- [ ] `npm run test:server` green, including new Group I (or extended
      Group D) batch-claim tests I1–I8.
- [ ] `npm run test:client` green, including new add/edit-item,
      hierarchy-picker, and group-claim-button tests; snapshot baselines
      reviewed and deliberately regenerated if the DOM changed.
- [ ] `single-writer-guard.test.js` gains explicit entries for
      `insertValueClaim` (or its shared composer) and
      `setValueGroupReviewStatus.run("claimed", ...)`, each mutation-proven
      once (temporarily add a second call site, confirm the guard fails,
      revert).
- [ ] Batch-claim is atomic: I2 (all-or-nothing on injected mid-batch
      failure) passes, proven by a `db.transaction()` wrapper whose absence
      the test can demonstrably catch.
- [ ] Mixed-availability outcome is a discriminated per-member value on the
      wire (I3) and in the UI (group-claim-button states test), never a
      single success/failure boolean; zero-`available` groups are a named
      outcome (I4), not a silent empty success.
- [ ] Batch-claim re-checks live availability at claim time, not Slice 3's
      cached approval-time snapshot (I6) — the "claimed out from under a
      pending batch-claim" race is covered.
- [ ] The claim-target picker (single-claim and group-claim) is proven to
      reuse `buildItemTree` rather than re-deriving the hierarchy (§9.1
      cross-consumer test, not eyeballing).
- [ ] Existing single-unit claim gesture test (line ~230 today) still
      passes unmodified in assertion shape, plus a new sub-item-target
      sibling case.
- [ ] The pre-existing single-claim `new_item` ordering gap (§2 above) has
      an explicit disposition recorded (fixed alongside the batch route,
      or filed as a follow-up) — not silently left both unfixed and
      unmentioned.
- [ ] `review_status='claimed'` transition is written by exactly one
      writer, in the same transaction as the batch-claim's `value_claims`
      inserts, per the architect's confirmation of the brief's open
      question #5.
