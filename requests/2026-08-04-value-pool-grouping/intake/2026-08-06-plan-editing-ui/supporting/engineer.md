# Engineer pass — Value Pool Slice 4 (plan editing UI + batch group claiming)

Grounded by direct read of `master` (current checkout) plus
`effort/2026-08-06-auto-group-proposal` (commit `72feac9`, unmerged Slice 3)
via `git show <branch>:<path>` / `git diff master <branch>` — no branch
switch performed, working tree stayed on `master` throughout.

## 1. Exact change set

### Server

- **`server/lib/plan-lifecycle.js`** — no changes needed for item CRUD.
  `insertProjectPlanItem` (line 117), `updateProjectPlanItem` (156),
  `deleteProjectPlanItem` (174) are all real, all reject writes once
  `plan.status !== "open"`, and `insertProjectPlanItem` already accepts
  `parent_item_id`. Confirmed by direct read — the request brief's premise
  is accurate.
- **`server/routes/project-plans.js`** — item CRUD routes already exist and
  need no change: `POST /:id(\d+)/items` (line 452), `PATCH
  /items/:itemId(\d+)` (460), `DELETE /items/:itemId(\d+)` (468), all
  delegating straight to `plan-lifecycle.js` and broadcasting
  `project_plan_updated`. **New code needed:** a batch-claim route, e.g.
  `POST /:id(\d+)/groups/:groupId(\d+)/claim` (or
  `/groups/:groupId(\d+)/claim-all` — naming is a technical-plan call), plus
  (once Slice 3 merges) importing `resolveMemberAvailability` and
  `listValueGroupMembersForRun`/`getValueGroup`/`getLatestValueGroupRun`
  equivalents from `server/lib/value-groups.js`.
- **`server/lib/value-groups.js`** (exists only on the Slice-3 branch today)
  — likely needs one new export: a batch-claim composer (working name
  `claimGroupMembers` or extend `resolveMemberAvailability`'s call site) that
  is the SOLE writer of `value_groups.review_status = 'claimed'`, matching
  the file's own header convention ("Sole writer: X (single-writer-guard
  G-8)"). This is new code, not present on the Slice-3 branch — confirmed by
  `grep -n "claimed" server/lib/value-groups.js` on that branch showing only
  the reserved-CHECK-value comment, no writer.
- **`server/db.js`** — no schema change needed. `value_groups.review_status`
  CHECK already includes `'claimed'` on the Slice-3 branch (confirmed
  above); no new statement beyond what Slice 3 already added, unless the
  technical plan wants a new prepared statement specifically for the
  transition (e.g. `setValueGroupReviewStatusClaimed`) rather than reusing
  `setValueGroupReviewStatus` — see Gotchas §6 on why reuse is risky here.
- **`server/__tests__/single-writer-guard.test.js`** — needs a new guard.
  Confirmed by direct grep: no existing test names `insertValueClaim` or
  `insertProjectPlanItem` at all (0 matches for both). This slice introduces
  the second production call site for `insertValueClaim.run(...)`
  (single-claim route today; batch-claim route tomorrow) and, if a
  `review_status='claimed'` writer is added, should register it the same
  way `setValueGroupReviewStatus`'s existing sole-writer comment does.

### Client

- **`client/src/lib/api.ts`** — `addItem`/`updateItem`/`deleteItem`/`claim`/
  `deleteClaim` under `api.projectPlans` **already exist on `master`**
  (confirmed by direct read, lines ~2903-2983; last touched in commit
  `4c2e931`, the Slice-2 coverage-on-demand build). This is a scope
  correction to the request brief's framing: the client API layer for
  single-item CRUD is not missing, only its UI. New client API needed:
  a `claimGroup`/`batchClaim` method calling the new server route.
- **`client/src/components/PlanLedgerPanel.tsx`** — the actual UI gap.
  Confirmed zero add/edit-item affordances today: `PlanSection` (line 313)
  renders only a title + Close button; `ItemTree`/`ItemNodeRow` (278-306)
  render item text + claim labels, strictly read-only, no onClick anywhere
  in that render path. Needed:
  - An "add item" / "add sub-item" form per `PlanSection` (open plans only —
    `closed` prop already gates every other affordance the same way, reuse
    that gate, don't invent a second one).
  - Edit-in-place for `ItemNodeRow`'s `node.text` (at minimum; `acceptance`/
    `detail`/`target_date` editability is a PM/technical-plan scoping call
    per the brief's own open question 2).
  - The claim-target `<select>` (line 572-583) needs to render
    `buildItemTree(items)`'s (line 266) output with indentation, not
    `openItems` (line 972, `openPlans.flatMap((p) => p.items.map(...))`) — a
    flat list with no depth info. **This must reuse `buildItemTree`**, not
    hand-roll a second nesting walk — PROJECT-CONTEXT.md §9.1
    DERIVED-DUAL-VIEW names this file's own `buildItemTree` explicitly as
    the one tree-builder; a picker-specific copy is exactly the "rogue
    re-derivation" sub-form the catalog warns about. The existing `<select>`
    already includes sub-items in its option list (data-wise) since
    `openItems` flattens the plan's full item array, parents and children
    alike — confirmed by direct read of line 972 — so this is a rendering
    fix, not a data-fetch fix.
  - A new group-review claim action, added once Slice 3 merges: `git diff
    master effort/2026-08-06-auto-group-proposal --
    client/src/components/PlanLedgerPanel.tsx` shows Slice 3 added a full
    group list/approve/dismiss UI (363 new lines) with **no claim
    action** — its own code comment on the approve handler states *"AC-5:
    pure bookkeeping ... never a plan item, milestone, or claim (PO §7/§8
    fence)"*, confirming the fence was deliberate, not an omission.
- **`client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json`** — every new
  UI string needs a `planLedger.*` key across all four locales (this
  file's header comment already states "every visible string routes
  through `useTranslation("projectDetail")`" — no new namespace). Slice 3's
  branch diff shows it added 45 lines to each of the four locale files for
  its own group-review strings — same shape, same four-file fan-out, is the
  precedent to follow, not skip.
- **`client/src/lib/types.ts`** — needs the group-claim request/response
  types once the server shape is fixed (see §2 below); Slice 3's branch
  already added `ValueGroup`/`ValueGroupMember`/`ValueGroupsResponse`/etc.
  (93 new lines) that Slice 4 builds on directly.

## 2. Mechanism verification

**Claim under test: "the claims API's atomic inline `new_item` already
supports the shape" (request.md, request-brief.md, both slices' framing).**
This is the single most load-bearing mechanism claim for this slice's
design, and it does **not hold up under direct read.**

`server/routes/project-plans.js`'s `POST /:id(\d+)/claims` handler (lines
482-574) does the following, **not** wrapped in a `dbModule.db.transaction()`
call:
1. If `body.new_item` is present, calls
   `planLifecycle.insertProjectPlanItem(...)` — a separate, already-committed
   `INSERT` under better-sqlite3's autocommit mode (line 500).
2. *Afterward*, validates `value_source`/`attribution`/`value_ref` (lines
   520-540) — all of which can 400 **after** the item row already committed.
3. *Afterward*, calls `dbModule.stmts.insertValueClaim.run(...)` (line 549),
   catching only a `UNIQUE` constraint violation as `DUPLICATE_CLAIM`.

The **only** existing test asserting atomicity — `project-plans-api.test.js`
"D4: new_item inline form is atomic — failure leaves neither claim nor item
created" (line 494) — exercises exactly one failure mode: `new_item: { text:
"" }`, which fails *inside* `insertProjectPlanItem` itself, **before any row
is ever inserted** (the function's own `INVALID_INPUT` guard at
`plan-lifecycle.js` line 134 returns a domain error with no DB write). It
does not construct the case this route's own code makes possible: an item
that inserts successfully, followed by a claim insert that then fails
(invalid `value_source`, missing `value_ref`, or a genuine `UNIQUE`
collision). In that case, as the code is actually written today, **the item
row is left committed and orphaned** — the opposite of what "atomic" means
and what D4's own test name asserts.

**Disposition:** the request/brief's "already supports the shape" premise is
true only for the happy path and for early-validation failures; it is false
as a general atomicity guarantee. This matters directly for Slice 4 because:
- The batch-claim route's own atomicity requirement (§3 below, "all
  eligible members land, or none do") **cannot** be built by literally
  looping today's single-claim logic N times and calling it a transaction —
  the thing being looped is not itself transactional.
- Any technical plan that says "reuse the existing atomic new_item path
  unchanged" needs to first close this gap (wrap the item-insert +
  claim-insert pair in one `dbModule.db.transaction()`), or explicitly scope
  the new batch route to use `item_id`-only (existing item/sub-item) plus a
  *separately* transactional new-item-then-claim-all path, and flag the
  pre-existing single-claim gap as a fast-follow rather than silently
  inheriting it into new code.
- Flagging this up: **this is a pre-existing defect independent of Slice 4**
  (D4's test is a false-green — it proves the vocabulary "atomic" is
  asserted, not that the code is atomic in the case that matters). Worth a
  one-line note to the PM/architect regardless of how Slice 4 is scoped.

**Claim verified true:** `value_groups.review_status` CHECK already includes
`'claimed'` and is genuinely unreachable in Slice 3's own shipped code.
Confirmed by direct read of `server/db.js` on the Slice-3 branch (CHECK
constraint literal `('proposed','approved','dismissed','claimed')`, line
~38 of the diff) and by the absence of any `'claimed'` write in
`value-groups.js`'s `module.exports` surface or in `project-plans.js`'s
Slice-3 route diff (only `approve`/`dismiss` call
`setValueGroupReviewStatus`, never with `'claimed'`). This part of the
brief's grounding is solid.

**Claim verified true:** `resolveMemberAvailability`'s three-state
vocabulary (`already_claimed`/`available`/`no_longer_in_pool`) is computed
read-time-only, never persisted — confirmed by direct read of
`server/lib/value-groups.js` lines 940-968 on the Slice-3 branch, and by the
schema comment on `value_group_members` explicitly stating "NO availability
column: that is derived at read time." Reusable as-is for the batch-claim
outcome vocabulary per the brief's own recommendation.

**Not independently verified (flagging, not asserting):** whether
better-sqlite3's synchronous single-connection model genuinely prevents any
interleaving DB write between "compute member availability" and "perform the
batch claim transaction" *within one Express request handler that has no
`await` between those two steps*. This is very likely true given
better-sqlite3's synchronous API and Node's single-threaded event loop (no
other JS can run mid-synchronous-call), but the *route* handler almost
certainly needs an `await` somewhere in between (e.g. re-resolving
`assembleValuePool`'s live units, which is `async`) — and once an `await`
exists, the window reopens for a concurrent single-claim request to land on
the same unit between the availability read and the transaction. This is
exactly the race the request brief's own open question 3 names ("time
passes between group approval and the claim click"). Concrete implication
for design, not just theory: the batch-claim transaction must re-verify each
member's availability **inside** the transaction (a fresh existence check
against `value_claims`, not trust in the pre-computed
`resolveMemberAvailability` snapshot), and must catch a `UNIQUE` violation
per-row inside the loop (same as the single-claim route already does at line
564) rather than letting one race abort the whole batch.

## 3. Feasibility

**Item CRUD UI half (independent of Slice 3):** genuinely simple. Server
and client-API layers are both complete; this is pure UI — forms, edit
affordances, tree-aware `<select>`. The one real design decision is field
scope for "edit" (brief's open question 2) and whether "add sub-item" is a
dedicated control per node or a `parent_item_id` dropdown on a single "add
item" form. Low hidden coupling — `buildItemTree` is already extracted and
reusable exactly where the picker needs it.

**Batch-claim half (depends on Slice 3 merge):** more coupled than it first
looks, for three reasons:
1. **The wire shape mismatch.** `GET /groups`'s `ValueGroupMember` (client
   type, Slice-3 branch) carries only `{ unitKey, availability }` — no
   `value_source`/`value_ref`/`source_cwd`/`label`/`attribution`/`stage`.
   The batch-claim route needs the **full** `ValueUnit` shape per member (to
   populate `value_claims.label_snapshot`/`stage_snapshot`/`attribution`,
   exactly as the single-claim route does today from the client-held
   `ValueUnit` object at `api.ts` line 2956-2973). The client does not hold
   this for a group's members today — the group-review UI never fetched
   full unit objects, only `unitKey` + availability. So the batch-claim
   route must do its own server-side join (raw `value_group_members` rows,
   via `listValueGroupMembersForRun`, against `assembleValuePool`'s live
   `units` — the same join `resolveMemberAvailability` already performs
   internally, but that function's own return shape throws the extra fields
   away before handing them to the route). This is new logic, not a
   straight reuse — either widen `resolveMemberAvailability`'s return (risk:
   a second consumer now depends on richer output, watch for the
   §9.1-flagged "consumer #2 changes the shared function" pattern) or add a
   sibling function that does the same join with the full unit payload.
2. **"Available" is DB-uniqueness-stricter, not looser.** The `already_claimed`
   availability state is keyed on `(value_source, value_ref)` only (excludes
   `item_id`) per `resolveMemberAvailability`'s own `memberKey` helper — but
   `value_claims`' actual UNIQUE index is `(value_source, value_ref,
   source_cwd, item_id)`, which technically permits claiming the same unit
   into a second, different item (already exercised by an existing test:
   "the SAME unit claimed into a DIFFERENT item must be allowed"). So Slice
   3's "already_claimed" vocabulary encodes a stricter *business* rule
   ("claimed once, anywhere, is enough") than the DB schema enforces. The
   batch-claim route must honor the business rule (skip
   `already_claimed` members), not the looser DB constraint, or the two
   claim gestures (single vs. batch) will silently disagree about what
   "claimed" means for the same unit.
3. **Ownership of the `'claimed'` transition.** Nothing currently writes it
   (verified §2). This slice's technical plan needs to decide, explicitly:
   does the batch-claim route set `review_status='claimed'` unconditionally
   once ANY member is actually claimed, or only when EVERY member reaches a
   terminal (claimed-or-already-claimed-or-gone) state? A group with mixed
   availability (some `already_claimed`, some `available`) still has a
   defensible "claimed" outcome once its `available` members are claimed —
   but that's a product decision (brief's open question 5), not a
   mechanical one, and determines whether `'claimed'` is set inside the same
   transaction as the `value_claims` inserts (matching the brief's own
   assumption) or requires a separate rule for all-unavailable groups (a
   named, non-silent outcome per §9.8 — see Gotchas).

**Variant branches:** the two group-claim actions ("claim into existing
item" vs. "create item then claim") are two request shapes hitting
conceptually the same composer — both need to land on one shared
transactional function (mirrors WATCH-6's "one composer, N callers"
convention already used for `enrichPoolAltitudes`/`insertValueSummaryGeneration`
elsewhere in this codebase), not two hand-written DB sequences. Sub-item
vs. top-level-item targets are not a separate code path — `insertProjectPlanItem`
already treats them uniformly via `parent_item_id`.

## 4. Effort estimate

- **Item CRUD UI (add/edit items + sub-items, hierarchy-aware picker
  refactor of the single-claim `<select>`):** **S** — no new server routes,
  no new client API methods, `buildItemTree` already extracted and reusable.
  Bulk of the work is form UI + i18n keys across 4 locales + updating
  `PlanLedgerPanel.test.tsx`.
- **Batch group claim (both actions: existing-item and
  create-then-claim):** **M** — one new server route, one new
  transactional composer function (with the join described in §3.1), a new
  single-writer guard, a new client API method, new UI wired into Slice 3's
  group-review section, plus the §9.8-mandated discriminated-outcome wire
  shape and its own mixed-availability test matrix. Contingent on Slice 3
  merge status (see §5) — if this slice's effort branch has to fork from the
  unmerged Slice-3 branch rather than `master`, that's schedule risk, not
  code-complexity risk, but it does mean the diff review surface temporarily
  includes Slice 3's ~9,449-line branch diff until Slice 3 merges
  independently.
- **Combined slice: M**, driven by the batch-claim half; the item-CRUD half
  alone would be S.

## 5. Dependencies & order

1. **Slice 3 must exist in the build environment before batch-claim can be
   built or tested** — `value_groups`/`value_group_members` tables,
   `resolveMemberAvailability`, and the `/groups` routes are all
   unavailable on `master` today (confirmed: `grep -n "value_groups"
   server/db.js` on `master` returns nothing). This is a hard precondition
   for compilation, not a design uncertainty — per the brief's own framing,
   the PM/architect must decide before build starts whether Slice 4 forks
   from `effort/2026-08-06-auto-group-proposal` or waits for that branch to
   merge to `master` first.
2. Within Slice 4 itself, recommended internal order:
   a. Item CRUD UI + hierarchy picker refactor first — zero Slice-3
      dependency, ships value immediately, and is the lower-risk half to
      get review feedback on before tackling the batch-claim transaction
      design.
   b. The shared transactional claim composer (server) — must land before
      either the "existing item" or "new item" batch-claim UI can be wired,
      since both group actions are two callers of the same composer, not
      two composers.
   c. The batch-claim route + its structural guard.
   d. The group-review UI's new claim action (client), wired last since it
      depends on (b) and (c) both existing.
3. **The single-writer guard for `insertValueClaim`/`insertProjectPlanItem`
   should be written concurrently with (b)**, not deferred — this is
   exactly the pattern PROJECT-CONTEXT.md's WATCH-6/§9.1 entries describe as
   "consumer #2 appears" being the moment duplication risk becomes real, and
   this slice is that moment for `insertValueClaim`.

## 6. Gotchas

- **The single-writer trap, concretely.** Do not let the batch-claim route
  call `dbModule.stmts.insertValueClaim.run(...)` directly in a loop inside
  its own handler — that is a second hand-copy of the exact insert sequence
  the single-claim route already performs (canonicalizing `source_cwd`
  through `cwdIdentity.canonicalizeCwd`, defaulting `label_snapshot`/
  `stage_snapshot` to `null`, choosing `claimed_by`). Extract a shared
  function (e.g. `insertOneValueClaim(dbModule, {...})` in
  `plan-lifecycle.js` or a new small module) both the single-claim route and
  the batch-claim composer call, matching this project's own precedent (
  `plan-writeback.js`'s `applyDisposition` as the sole composer, guarded by
  `single-writer-guard.test.js`'s brace-walk pattern at lines 131-212).
- **§9.8 OVERLOADED-ABSENCE, the sibling case not yet named in the brief's
  own worked example.** The brief covers "some members already_claimed,
  some available" well. The genuinely dangerous edge is the **all-members-
  unavailable** case: a group where every member is `already_claimed` or
  `no_longer_in_pool` at claim time. If the batch-claim response's "how many
  claimed" count is `0`, that must be a **named, distinguishable outcome**
  (e.g. `outcome: "no_claimable_members"`), not a `200 {claimed: []}` that
  looks identical to "you clicked claim on an empty group" or to a
  successful no-op. This is precisely the "a group with no members
  resolved" example the parent request's own Constraints section names by
  name as the standing trap for this surface — don't let it collapse to a
  silent empty success.
- **Hand-editing the wrong copy of "how does parent_item_id become a
  tree."** Confirmed there is exactly one tree-builder today
  (`buildItemTree`, `PlanLedgerPanel.tsx` line 266). Any new
  picker component MUST import and call this function, not re-walk
  `parent_item_id` a second time inline in a `<select>`'s render — this is
  the literal §9.1 DERIVED-DUAL-VIEW failure mode this codebase has hit
  repeatedly (5 prior touches logged in PROJECT-CONTEXT.md as of this
  read).
- **The `review_status='claimed'` CHECK is rebuild-to-widen (WATCH-4/
  §9.6-adjacent).** It's already correctly widened on the Slice-3 branch —
  do not add a second, separate CHECK-relaxation migration in Slice 4; the
  column and its valid value are already there waiting.
- **Closed-plan immutability must extend to the batch path.** Every
  existing item/claim mutation route checks `plan.status === "open"` before
  writing (`plan-lifecycle.js` lines 120, 160, 178, and the claims route at
  line 486). The batch-claim route must apply the same guard for its target
  plan — trivial to forget since the group being claimed lives in a
  different table (`value_groups`) with no `plan_id` of its own; the check
  has to be against whichever plan/item the group is being claimed *into*.
- **`insertProjectPlanItem`'s `parent_item_id` validation is shallow.** It
  only checks that the parent item exists (`plan-lifecycle.js` line 137),
  not that the parent belongs to the *same plan* as the new item, nor that
  it doesn't create a cycle. Not a regression this slice introduces, but the
  new UI is the first caller that will let a user pick an arbitrary parent
  from a hierarchy display — worth a defensive same-plan check either in
  the UI (only show current plan's items in the parent picker, which
  `buildItemTree` operating on one plan's `items` array already does
  naturally) or flag to the architect if cross-plan parenting is a real risk.
- **i18n fan-out.** Four locale files, every new string. Easy to ship
  English-only and pass a superficial smoke test while `ko`/`vi`/`zh` sit
  keyless. Slice 3's own branch diff (45 lines × 4 locales, identical shape)
  is the pattern to copy exactly.

## 7. Verification hooks

- **`server/__tests__/plan-lifecycle.test.js`** — covers
  `insertProjectPlanItem`/`updateProjectPlanItem`/`deleteProjectPlanItem`
  directly; should need no new cases for the item-CRUD half (already
  exercises `parent_item_id`, closed-plan rejection) but is the file to
  extend if edit-field scope grows.
- **`server/__tests__/project-plans-api.test.js`** — the single-claim route
  suite, including "D4: new_item inline form is atomic" (line 494, see §2 —
  this test's own coverage gap should be closed as part of any transaction
  fix) and the "same unit into a different item is allowed" case (~line
  470-481) that the batch-claim's availability logic must not contradict.
  This is also where the new batch-claim route's own request/response tests
  belong, or a sibling `value-groups-claim.test.js` file if the team prefers
  one file per route family (matching the Slice-3 branch's own convention
  of a dedicated `value-groups-api.test.js` alongside
  `project-plans-api.test.js`).
- **`server/__tests__/single-writer-guard.test.js`** — needs a new `it(...)`
  block for `insertValueClaim`'s second call site, modeled directly on the
  existing `markValueUnitSummariesSeen`/`requestValueCoverage` guards (lines
  285-385) which already prove the brace-walk pattern for "exactly one
  lexical call site inside handler X." Both those examples are good direct
  templates since they guard a route-level write, same shape this slice
  needs.
- **`client/src/components/__tests__/PlanLedgerPanel.test.tsx`** — the
  existing render/interaction suite for this component; needs new cases for
  add/edit-item forms and the hierarchy-aware picker's rendering (indent
  depth, parent labeling).
- **`client/src/components/__tests__/PlanLedgerPanel.groups.test.tsx`**
  (Slice-3 branch, 562 lines) — the group-review UI's existing test file;
  the new claim action's client-side tests belong here once Slice 3 merges,
  extending its existing approve/dismiss test patterns rather than starting
  a new file.
- **`client/src/pages/__tests__/screens.snapshot.test.tsx`** — per-screen
  render snapshots; per CLAUDE.md's testing policy, any visible UI change
  here needs a reviewed snapshot regen (`cd client && npx vitest run -u`),
  not a blind update. Slice 3's branch diff already touched this file's
  snapshot (25 new lines) for its own group-review UI — Slice 4 will touch
  it again for the new item-CRUD affordances and claim action.
- **Not run as part of this intake pass** (read-only investigation): no
  tests were executed. `npm run test:server` / `npm run test:client` should
  be run once real code exists, per CLAUDE.md's testing policy — this
  document only inventories which existing files would need to go green (or
  be extended) once the slice is built.
