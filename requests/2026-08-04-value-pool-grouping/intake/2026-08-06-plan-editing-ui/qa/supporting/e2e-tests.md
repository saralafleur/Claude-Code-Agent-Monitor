# E2E / API-contract test design — Value Pool Slice 4a (plan-editing-ui)

> Authored by `qa-e2e-architect`. Change under evaluation is **NOT YET
> BUILT** — this is a forward, test-first design, grounded in
> `qa/change-brief.md` and `technical-plan.md` §3/§4/§5/§8. This is the thin,
> wired-up-flow layer over the unit layer
> (`plan-lifecycle.test.js`'s P1-P7 re-parent validation matrix,
> `single-writer-guard.test.js`'s G-A/G-B, `PlanLedgerPanel.test.tsx`'s C1-C7
> component cases) — it proves add→edit→claim and re-parent→claim really work
> end to end over real HTTP against a real DB, not every validation
> permutation (that's `plan-lifecycle.test.js`'s job) and not every render
> detail (that's `PlanLedgerPanel.test.tsx`'s job).

## 0. What this project's "E2E" is (grounding, reused verbatim from the two prior Slices' own QA passes — Slice 2 `coverage-on-demand`, Slice 3 `auto-group-proposal`)

No Playwright/Cypress/browser-automation harness exists in this repo
(confirmed: no `*e2e*`/`playwright*`/`cypress*` path anywhere outside
`node_modules`, and `PROJECT-CONTEXT.md` names no such tool). This project's
"E2E" is: **boot the real Express app (`createApp`/`startServer` from
`server/index.js`) against a real throwaway SQLite file, drive it over real
HTTP.** The exact precedent file for this change's surface is already
present and already covers the same routes: `server/__tests__/project-plans-api.test.js`
(Groups A–H, S, T — plan CRUD, item CRUD, closure, claims cardinality, pool,
health, import). This change touches **no new routes** (`POST /:id/items`,
`PATCH /items/:itemId`, `POST /:id(\d+)/claims` all already exist and already
have HTTP-level coverage) — it changes what those routes *accept* and *do*
(`parent_item_id` on PATCH becomes real; the claims route becomes atomic).
That makes this an **extension of the existing file**, not a new one — this
project's own convention (per Slices 2/3's QA passes) is "one named spec
file per behavioral shape," and there is no new behavioral shape here that
project-plans-api's existing Group B (item CRUD) / Group D (claims) shapes
don't already own.

Slice 4a introduces **no new WS message type** (`value_claim_updated` and
`project_plan_updated` are unchanged — confirmed against
`technical-plan.md` §3.3's "broadcast fires after the transaction returns,
never inside it," which changes *when* `value_claim_updated` fires relative
to the transaction, not *whether* or *what*), so unlike Slice 2's
`coverage-request-e2e.test.js`, no real `ws` client is needed for this
design — every assertion below is plain HTTP request/response, matching
`project-plans-api.test.js`'s existing style throughout.

**Bucket/tag convention finding (unchanged from Slices 1–3):** no
smoke/regression tag system, no serial-vs-parallel bucket split exists on
this project. `npm run test:server` (`node --test server/__tests__/*.test.js`
— one file = one isolated child process, tests inside a file run
sequentially by default) and `npm run test:client` (`vitest run`) run
unconditionally in CI. The de-facto bucket is **one named spec file per
behavioral shape**; this design adds new `it()` cases inside two files that
already own the relevant shape (`project-plans-api.test.js` for the
route/HTTP layer, `plan-lifecycle.test.js` for the one domain-layer case
that has no route to hang off — see §2b) rather than inventing a third file.

**Fixture technique reused, not reinvented:** `makeProject`/`fetch`/`post`/
`patch`/`del` from `project-plans-api.test.js`'s own top-of-file helpers
(lines 27-68); the file's own "each group's own `before()` creates the
fixtures that group needs" idiom (used verbatim by Groups A–H, S, T).

---

## 1. Flows to cover

1. **Full add-item → edit-item → claim-a-unit-into-it happy path, through the
   real route layer** (AC-8, AC-9 as narrowed by `DEC-S4-3`, AC-13). Create a
   top-level item and a sub-item under it via `POST /:id/items` (both already
   existing routes, unchanged shape). Edit the sub-item's `text` only via
   `PATCH /items/:itemId` and confirm placement is untouched (the "absent key
   = no placement change" contract §3.4 makes load-bearing on the wire).
   Separately, edit the sub-item's placement only and confirm `text` is
   untouched — the **mirror case** the change-brief's Open Questions section
   flags as not explicitly named in the plan's own P1-P7 list (§5's P3 only
   names the reverse: placement present, text untouched). This design closes
   that gap explicitly rather than assuming it's incidentally covered. Then
   claim a real unit into the (now-edited, now-placed) sub-item via
   `POST /:id/claims`, and `GET /:id` to confirm the claim nests under the
   correct item, at the correct depth, with `POST /:id/claims`'s response
   shape byte-identical to `master` (AC-13 / Definition of Done's byte-
   identical requirement, checked at the route boundary, not just by code
   inspection of the delegator).
2. **Re-parent-then-claim: does the server-side hierarchy the claim route
   resolves against reflect a just-changed parent, with no staleness** (the
   API-contract half of C6/C7's client-level proof; `DEC-S4-7`'s "structural
   cure first" server guard exercised dynamically, not just against a static
   fixture). Build a 3-node fixture (A top-level, B and C both children of
   A), re-parent C under B, and in the **very next** `GET /:id` confirm C
   nests under B, not A — no cache, no second write needed to "settle." Then
   claim a unit into C via `POST /:id/claims` and confirm, in the next
   `GET /:id`, that the claim is nested under C which is nested under B —
   proving the claims route resolves item membership against live state, not
   a snapshot taken before the re-parent. Close the loop with a **dynamic**
   cycle check the plan's own P5 fixture (a static 3-level grandparent/
   grandchild) doesn't reach: having just made C a child of B, attempt to
   re-parent B under C (a cycle created by the *previous* mutation, not by
   the test's initial fixture) → `400 INVALID_INPUT`, and confirm via a
   follow-up `GET /:id` that the tree is byte-identical to before the
   attempt (B still under A, C still under B) — the item never silently
   vanishes from `roots` (§9.8 OVERLOADED-ABSENCE, the corruption
   `DEC-S4-7`'s two-layer mitigation exists to prevent).
3. **Claims route atomicity, at the HTTP boundary — already specified,
   referenced not redesigned.** `technical-plan.md` §5 fully specifies **D4
   (rewritten)** and **D4b** inside this same file (`project-plans-api.test.js`
   Group D), including the red-first mutation-proof step. This design does
   not re-derive those cases; §4 below notes only the one seam worth adding
   on top of them: confirming the *existing* Group D regression cases (D1-D3,
   D5) and the new B-flow (this document's flow 1) still pass **unmodified**
   in the same file, so the atomicity fix and the hierarchy-edit surface are
   proven not to have disturbed each other's routes in one shared run of the
   file — cheaper than a dedicated cross-file spec, and the file's existing
   `describe` isolation already gives each Group its own fixtures.

**Explicitly not re-covered here** (unit/component layer's job, listed so
nobody re-derives it by hand into this document — see §6):
- The full four-step re-parent validation chain (self-parent, cross-plan
  parent, static-fixture cycle, closed-plan) as an exhaustive matrix —
  `plan-lifecycle.test.js`'s P1-P7, called directly against
  `planLifecycle.updateProjectPlanItem`, which is strictly cheaper per case
  than routing every validation branch through HTTP. This document's flow 2
  exercises the cycle guard exactly once, dynamically, as a flow-level proof
  that the mechanism the unit tests validate in isolation actually engages
  when reached through a real prior mutation — not a second exhaustive pass.
- `insertValueClaim`/`insertProjectPlanItem`/`reparentProjectPlanItem`
  single-lexical-call-site guards (G-A, G-B) and their mutation-proofs —
  `single-writer-guard.test.js`'s job, a structural scan, not a flow claim.
  (Per the change-brief's Open Question, G-B needs a named, dated exception
  for `importLegacyPlan`'s pre-existing `insertProjectPlanItem.run(` call
  site before it's written — this project's own `GRANDFATHERED_QUERIES` /
  `FILE_DISPOSITIONS` pattern, precedent in `chronology-ordering.test.js`.
  That's the unit/structural-guard architect's call to make, not this
  document's; noted here only so the dependency is visible.)
- `flattenItemTree`'s cross-consumer equality proof (C3) and the parent-
  picker's self+descendant exclusion walking `ItemNode.children` rather than
  re-deriving from `parent_item_id` (C7) — `PlanLedgerPanel.test.tsx`, pure
  component-level claims that don't need a live server.
- The stale-claim-target render fix (`effectiveTargetId`, C4's second half) —
  component-level, no route involved.
- Four-locale `planLedger.*` key parity — `i18n.test.ts`.
- `screens.snapshot.test.tsx` baseline review for `PlanLedgerPanel`'s DOM
  changes — reviewed and regenerated deliberately as part of the client
  change set (`WATCH-S4-A`), not this document's job.

---

## 2. Spec file(s)

### 2a. `server/__tests__/project-plans-api.test.js` (EXTEND — new `describe` block; no new file)

Covers flows 1 and 2. This file already owns the HTTP-level shape for every
route this change touches (`POST /:id/items`, `PATCH /items/:itemId`,
`POST /:id(\d+)/claims`) via Groups B and D — extending it, rather than
adding a new file, follows the project's own "new file only when a genuinely
new behavioral shape appears" convention (no new route is added in 4a).

**Where:** a new `describe("Group I: hierarchy-aware editing + claim flow
(Slice 4a)", ...)` block, placed after Group H (namespace isolation) and
before Group S (audit semantics) — the file's existing group letters are not
alphabetically contiguous already (`S`, `T` were appended later), so `I` is
free and keeps the new block visually distinct from Group B's narrower
per-field CRUD cases and Group D's narrower claims-cardinality cases; this
block is specifically the **cross-cutting flow** the other two groups don't
individually prove.

**Bucket:** `server/__tests__/*.test.js`, run by `npm run test:server`, same
child process/file as every other Group in this file (own `before()` seeds
its own project/plan, per the file's existing per-group isolation idiom —
confirmed live at lines 92, 219-227, 297-302, 395-406, 559-566, 616-623,
676-681, 787-789, 826).

**Setup, reusing existing precedent verbatim:** `makeProject`, `post`,
`patch`, `fetch`, `del` from the file's own top-of-file helpers (lines
27-68) — no new helper needed.

**Scenario steps (flow 1 — happy path):**
1. `makeProject` → `POST /api/project-plans` → open plan.
2. `POST /:id/items { text: "Parent" }` → 201, top-level (`parent_item_id:
   null`).
3. `POST /:id/items { text: "Child", parent_item_id: <parent.id> }` → 201.
4. `PATCH /items/<child.id> { text: "Child, renamed" }` (no `parent_item_id`
   key at all) → 200; re-`GET /:id` and assert the child's `text` changed
   **and** `parent_item_id` is unchanged from step 3 — the existing-field
   regression the plan's own P3 already names.
5. **Mirror case (the gap this document closes):** `PATCH /items/<child.id>
   { parent_item_id: null }` (promote to top-level, no `text` key) → 200;
   re-`GET /:id` and assert `parent_item_id` is now `null` **and** `text` is
   still `"Child, renamed"` from step 4 — proving the reverse direction of
   "absent means unchanged" holds over the real route, not just for the
   field the plan's P3 happened to name.
6. `POST /:id/claims { item_id: <child.id>, value_source: "detour",
   value_ref: "flow1-detour", attribution: "judgment" }` → 201; assert the
   response shape (`claim.id`, `claim.item_id`, `claim.value_ref`, etc.) has
   exactly the same keys `project-plans-api.test.js`'s existing D1 case
   asserts (byte-identical contract, AC-13).
7. `GET /:id` → the claim is nested under the child item, which is now a
   **top-level** item (per step 5) — proving the read path reflects both the
   text edit and the placement edit together, not just whichever happened
   last in isolation.

**Scenario steps (flow 2 — re-parent-then-claim, own sub-`describe` /
fixture, same Group I block):**
1. `makeProject` → new open plan → `POST /:id/items` three times: `A` (top-
   level), `B { parent_item_id: A.id }`, `C { parent_item_id: A.id }`.
2. `PATCH /items/<C.id> { parent_item_id: <B.id> }` → 200.
3. **Immediately** `GET /:id` (no intervening write) → assert `C`'s
   `parent_item_id === B.id` in this single read — no second request needed
   to "settle," proving there is no cache between the write and the read.
4. `POST /:id/claims { item_id: C.id, value_source: "detour", value_ref:
   "flow2-detour", attribution: "judgment" }` → 201.
5. `GET /:id` → assert the claim from step 4 is nested under `C`, and `C` is
   nested under `B` (not `A`) — the claim route resolved `item_id: C.id`
   against `C`'s **current** plan membership/placement, not a snapshot taken
   before step 2's re-parent.
6. **Dynamic cycle, not the plan's static P5 fixture:** `PATCH /items/<B.id>
   { parent_item_id: <C.id> }` → this is now a cycle only because of step 2's
   own mutation (before step 2, `B` and `C` were siblings; a cycle here would
   have been unreachable) → assert `400`, `error.code === "INVALID_INPUT"`.
7. `GET /:id` immediately after step 6's rejection → deep-equal the returned
   tree against step 5's read (same parent/child edges, same claim
   placement) — the rejected cycle attempt left **zero** trace: `B` is still
   under `A`, `C` is still under `B`, nothing vanished from the response's
   item list (the concrete, HTTP-level proof of `DEC-S4-7`'s "no item
   disappears from the ledger with no error" requirement, `§9.8`).

**Scenario steps (flow 3 — shared-file non-interference check, same Group I
block, last case):** after flows 1 and 2 and Group D's D4/D4b (rewritten
atomicity cases, specified in `technical-plan.md` §5 and not redesigned
here) have all run in this file, assert Group D's existing D1/D2/D3/D5 cases
— read directly, not re-executed as a copy — still pass unmodified in the
same `node --test` run. This is not a new assertion to write; it's the
existing full-file run itself serving as the cheapest available proof that
the atomicity refactor (Group D) and the hierarchy-edit surface (Group I)
don't collide on shared route code, at zero marginal cost beyond running the
file.

### 2b. `server/__tests__/plan-lifecycle.test.js` (EXTEND — one case, not a redesign of P1-P7)

`technical-plan.md` §5 already fully specifies **P1-P7** (the exhaustive
re-parent validation matrix: promote, self-parent, cycle, cross-plan,
closed-plan) as new cases inside this file's existing `describe("plan
lifecycle (A2)", ...)` block, called directly against
`planLifecycle.updateProjectPlanItem` — domain-layer, not HTTP, and
correctly so (cheaper per validation branch than routing through Express).
This document does not redesign P1-P7. It adds exactly **one** case beyond
them, because it is the one assertion that genuinely needs the *route* layer
to be meaningful and P1-P7 don't reach it:

- **New case (append to the file's numbering — next available slot after the
  existing A2.1-A2.19, so **A2.20**, mirroring the file's own
  `describe("re-parent (DEC-S4-7)", ...)` grouping convention already used
  for "concurrent plans, DEC-P5"):** `claimUnitIntoItem` (the new sole
  `value_claims` composer, called directly, domain-layer) rejects a claim
  whose `item_id` was re-parented **out of the target plan's actually-
  claimable set** only if it's no longer a member of that plan at all —
  i.e., confirms the composer's plan-membership check (`item_id` must belong
  to `planId`) is re-evaluated against **current** state on every call, not
  cached from a prior resolution, by re-parenting an item into a *different*
  plan (a cross-plan re-parent is itself rejected per P6 — so this case
  instead deletes-and-recreates under the other plan, or equivalently
  claims into an item, closes that check off, and confirms the plan's own
  P6 guard is what `claimUnitIntoItem` relies on rather than re-implementing
  its own weaker check). **Purpose:** flow 2 (§2a) proves the *read* path
  (`GET`) reflects a live re-parent; this case proves the *write* path
  (`claimUnitIntoItem`) does too, at the one seam (cross-plan membership)
  that a pure HTTP-level test can't isolate as cleanly as a direct domain
  call can (HTTP would conflate the route's own validation with the
  composer's).

**Bucket:** same file, same `npm run test:server` run, no isolation change
needed — `plan-lifecycle.test.js` already runs in its own child process.

---

## 3. Tag

No smoke/regression tag system exists on this project (§0) — nothing to
set. Both extended files run as part of the standard, unconditional
`npm run test:server` CI step. **Serial requirement:** Group I's flow 1 and
flow 2 sub-scenarios each build one seeded plan and mutate it in a fixed
order (create → edit → claim → read) — do not opt any case into `node:test`'s
`{ concurrency: true }`; this matches every existing Group in the file
(default sequential `node --test` execution, confirmed at lines 92-826).

---

## 4. Assertions (concrete, reused where a helper/fixture already exists)

- **Round-trip integrity, both directions:** an update touching only `text`
  leaves `parent_item_id` untouched (existing P3, flow 1 step 4), **and** an
  update touching only `parent_item_id` leaves `text` untouched (flow 1 step
  5 — the mirror case this document adds because the change-brief flagged it
  as assumed-but-unconfirmed, not because the plan omitted it by oversight).
- **A reread value matches what was just saved, with no intervening write:**
  flow 2 step 3 (`GET` immediately after `PATCH`) and step 5 (`GET`
  immediately after `POST /claims`) are exactly this — the "regenerated/
  reloaded value matches what was saved" acceptance shape, applied to
  hierarchy state rather than a generated artifact.
- **No unresolved placeholder or stale reference reaches the response
  contract:** flow 1 step 6/7 assert the claim response and the nested plan
  read use the exact same field names `project-plans-api.test.js`'s existing
  D1 case already asserts — no new/renamed/dropped key (AC-13's byte-
  identical requirement, checked at the wire, not by reading the delegator's
  source).
- **Variant/isolation holds under a real prior mutation, not just a static
  fixture:** flow 2 step 6's cycle rejection is deliberately built from a
  re-parent the test itself just performed (step 2), not from a hand-built
  3-level tree at fixture-creation time — proving the guard engages on
  dynamically-reached state, the exact shape `DEC-S4-7` exists to guarantee
  and that a purely static P5 fixture (in `plan-lifecycle.test.js`) can't by
  itself demonstrate at the route layer.
- **Overloaded-absence guard, checked positively:** flow 2 step 7's
  deep-equal against step 5's read is the concrete proof that a rejected
  cycle attempt leaves **zero** trace — no item silently drops out of the
  `items` array in the API response (§9.8).
- Reuse existing fixtures/helpers rather than reinventing:
  `makeProject`/`post`/`patch`/`fetch`/`del` (`project-plans-api.test.js`
  lines 27-68); direct `planLifecycle.updateProjectPlanItem`/
  `claimUnitIntoItem` calls (`plan-lifecycle.test.js`'s own existing style,
  e.g. `A2.4`'s direct `closePlan` call).

---

## 5. How to run a single spec

No base URL / external environment prerequisite — both files boot their own
throwaway SQLite file and an ephemeral in-process HTTP server on port 0
(OS-assigned), exactly like every other spec in `server/__tests__/`. No live
integration stack, Docker, or shared seeded dashboard DB required.

```bash
# Route/HTTP-level flow (Group I: happy path, re-parent-then-claim) —
# also runs the file's existing Groups A-H, S, T (incl. D4/D4b) in the
# same process, which is flow 3's non-interference proof for free
node --test server/__tests__/project-plans-api.test.js

# Domain-layer re-parent matrix (P1-P7) + this document's one added case
# (claimUnitIntoItem's live plan-membership re-check, A2.20)
node --test server/__tests__/plan-lifecycle.test.js

# Full server suite (what CI actually runs)
npm run test:server
```

`node --test` does not offer a clean per-`it()` name filter the way
`vitest -t` does on the client side (no client-side spec is added by this
design — see §1's "explicitly not re-covered here"), so iterate by running
the whole file; both files are already fast (throwaway in-memory-speed
SQLite, no network, no spawn).

---

## 6. Cost note — minimum set, and what stays at the unit layer

E2E here means "boot a real server + real DB," materially more expensive
per-assertion than `plan-lifecycle.test.js`'s direct domain-layer P1-P7
matrix or `PlanLedgerPanel.test.tsx`'s component-level C1-C7. This design
adds **one new `describe` block (two flow-shaped scenarios, ~10 HTTP round
trips total) to an existing file, plus one case to a second existing
file** — deliberately not a matrix, and deliberately zero new files, because
no new route or WS surface exists in 4a for a new file to justify.

**Intentionally NOT re-covered here, because it is already proven cheaper at
the unit layer and duplicating it here would only slow CI for no new
information:**
- The full self-parent / cross-plan-parent / static-fixture-cycle /
  closed-plan validation chain, exhaustively — `plan-lifecycle.test.js`'s
  P1-P7, called directly against `updateProjectPlanItem`, far cheaper per
  branch than routing each one through Express. This document's flow 2
  exercises the cycle branch exactly once, and only because it needs to be
  *dynamically* reached to prove the read-path/write-path liveness claim —
  not because the branch itself needs re-proving.
- `insertValueClaim`/`insertProjectPlanItem`/`reparentProjectPlanItem`
  single-lexical-call-site guards and their mutation-proofs (G-A, G-B) —
  `single-writer-guard.test.js`'s job, a structural scan that gains nothing
  from a live HTTP round trip.
- `flattenItemTree`'s cross-consumer equality (C3), the parent-picker's
  self+descendant exclusion walking `ItemNode.children` (C7), and the
  stale-claim-target render fix (`effectiveTargetId`, C4) —
  `PlanLedgerPanel.test.tsx`'s job; none of these need a live server, and a
  real HTTP round trip cannot observe render-level details like option
  ordering or DOM indentation any more cheaply than RTL already does.
- Four-locale `planLedger.*` key parity — `i18n.test.ts`, mechanically
  enforced elsewhere, not re-derived here.
- The atomicity fix's own red/green mutation-proof (remove the
  `transaction(...)` wrapper, observe D4 fail, restore, re-run green) —
  already fully specified in `technical-plan.md` §5/§4 step 5 as Group D's
  own D4/D4b; this document references but does not redesign it (§1, flow
  3), and does not duplicate the mutation-proof procedure here.
- A `WATCH-S4-F`/`WATCH-S4-G`-shaped delete or reorder flow — correctly
  out of scope for 4a per the change-brief; no coverage designed for either.
