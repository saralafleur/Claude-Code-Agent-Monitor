# Change Brief — plan-editing-ui (Value Pool Slice 4, Phase 4a)

> Authored by `qa-triage`. The single normalized statement of *what we are
> about to build*, before any coverage evaluation. No code has been written
> yet — this is a pre-build QA pass against a completed technical plan.

- **Date:** 2026-08-06
- **Scope source:** intake-handoff — `technical-plan.md` "Change set" (§3) and
  "Implementation steps" (§4), cross-checked live against `master`
  (`d384249`, current HEAD, clean except unrelated in-flight files noted below).
- **Intake link:** `requests/2026-08-04-value-pool-grouping/intake/2026-08-06-plan-editing-ui/`
- **In scope for this QA pass:** Phase **4a only** — item/sub-item CRUD UI,
  hierarchy-aware claim picker, and the single-claim atomicity fix. Buildable
  against `master` today.
- **Explicitly out of scope:** Phase **4b** (batch group claiming) — hard-blocked
  on Slice 3's unmerged `value_groups` schema, carried in `technical-plan.md` §9
  as a deferred phase with a named trigger (`WATCH-S4-C`). Not planned or
  assessed here.

## Change summary
Slice 4a gives `PlanLedgerPanel` a real add/edit surface for plan items
(`text` + hierarchy placement only, per `DEC-S4-3`), makes the claim-target
`<select>` render the same `buildItemTree` hierarchy the read-only tree
already uses (via a new `flattenItemTree` projection), and — folded in as a
`bug` carve-out under `DEC-S4-2` — makes the single-unit claim route
genuinely atomic by extracting its write path into one shared, transactional
composer (`claimUnitIntoItem`) that both routes will eventually share.

## Changed files (by layer) — as specified, not yet built
**Backend — database layer**
- `server/db.js` — add one prepared statement, `reparentProjectPlanItem`
  (`SET parent_item_id = ?, updated_at = ...`). No schema change, no migration.

**Backend — domain layer**
- `server/lib/plan-lifecycle.js` — extend `updateProjectPlanItem` to handle
  `parent_item_id` (intent-detected via `Object.hasOwn`, 4-step validation,
  wrapped in a transaction); add new export `claimUnitIntoItem` (sole
  `value_claims` writer, validate-then-transact, catch-outside-transaction for
  the `UNIQUE` collision); update file-header ownership claim.

**Backend — route layer**
- `server/routes/project-plans.js` — `POST /:id(\d+)/claims` reduced to a thin
  delegator calling `claimUnitIntoItem`. No new routes; `PATCH /items/:itemId`
  needs no route change (already passes `req.body` through).

**Frontend — API client**
- `client/src/lib/api.ts` — no new methods; doc-comment update on `updateItem`
  making the existing (already-typed, currently-lying) `parent_item_id`
  contract honest.

**Frontend — component**
- `client/src/components/PlanLedgerPanel.tsx` — new `flattenItemTree`
  projection; `openItems` rebuilt from the tree; claim `<select>` gets
  depth-indented options; stale-claim-target render fix; `PlanSection` gains
  an add-item form; `ItemNodeRow` gains edit-in-place (text + placement, with
  self+descendant exclusion in the parent picker).

**i18n**
- `client/src/i18n/locales/{en,ko,vi,zh}/projectDetail.json` — new
  `planLedger.*` keys, all four locales, same commit.

**Tests (per the plan's own spec — not yet written)**
- `server/__tests__/project-plans-api.test.js` — D4 **rewritten** (not
  extended) to the post-item-insert failure case; new D4b.
- `server/__tests__/plan-lifecycle.test.js` — new P1-P7 (re-parent
  validation cases).
- `server/__tests__/single-writer-guard.test.js` — new G-A (`insertValueClaim`
  single-call-site) and G-B (`project_plan_items` writers single-call-site).
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` — new C1-C7.
- `client/src/pages/__tests__/screens.snapshot.test.tsx` — will need a
  reviewed (never blind) regeneration; `PlanLedgerPanel`'s DOM changes
  materially.

**Config / other**
- `catalog-patch.md` (this intake folder) applied to `PROJECT-CONTEXT.md` and
  deleted, in the effort-branch commit that copies the request tree
  (`DEC-S4-4`) — a process step, not a product change.
- `bash .claude/skills/file-headers/scripts/check-headers.sh` must exit 0 on
  every touched file.

## Surfaces / features touched
- **`PlanLedgerPanel`** (`client/src/components/PlanLedgerPanel.tsx`) — the
  plan-editing/claim UI on the project detail page. This is the component
  this project's own catalog names as carrying its
  `MONOTONIC-GUARD-ACROSS-ENTITY-SWITCH` and `STRICTMODE-BLIND CLIENT SUITE`
  candidate patterns (per `DEC-S4-3`'s rationale) — worth the test team's
  attention even though this change doesn't touch those mechanisms directly.
- **`POST /:id(\d+)/claims`** (single-unit claim route,
  `server/routes/project-plans.js`) — atomicity fix, response-shape-preserving
  refactor.
- **`PATCH /items/:itemId`** — gains real `parent_item_id` support (was
  previously a no-op for that field).
- **`plan-lifecycle.js`** domain module — new sole-writer composer
  (`claimUnitIntoItem`) that **4b will loop over**, so its shape is being set
  now for a consumer that doesn't exist yet.

## Variant relevance
Two variant classes apply here, both named in this project's own catalog:

1. **Cross-consumer hierarchy rendering (§9.1 DERIVED-DUAL-VIEW shape).**
   `buildItemTree` gains its **2nd and 3rd consumers** in this slice — the
   claim-target picker and (via the new add-item/edit-in-place parent
   pickers) two more render sites — which is the exact "consumer #2 appears"
   moment this catalog entry's own history says the failure lands. The plan's
   answer (a typed `flattenItemTree(ItemNode[])` projection, never a second
   `parent_item_id`-walking function) is the right shape and is proactive
   rather than reactive here.
2. **i18n locale parity** — `en`/`ko`/`vi`/`zh` must ship the same
   `planLedger.*` key set in the same commit. Standard project convention;
   no new registry mechanics needed since this is a flat, non-plural key
   group.

Not applicable here: this project has no tenant/office/role variant surface
in scope for this change.

## Test-invariants at risk
- [x] **Cross-consumer hierarchy consistency — §9.1 DERIVED-DUAL-VIEW.**
  `buildItemTree` now feeds the read-only `ItemTree`, the claim `<select>`
  (via `flattenItemTree`), and two new parent pickers (add-item form,
  edit-in-place). The plan names this explicitly and specifies test **C3** as
  a cross-consumer *equality* assertion (reorder the input, assert both
  consumers change identically), not two independent per-component checks —
  matching this catalog entry's stated acceptance criterion. **Confirm at
  build:** C3 is written as equality, not eyeballing.
- [x] **Rogue re-derivation, not just rogue reading — §9.1's twice-proven
  corollary.** The parent-picker exclusion logic (self + descendants) is
  supposed to walk the already-materialized `ItemNode.children`, "not
  re-derive from `parent_item_id`" (plan's own words, §3.5). A structural scan
  for raw `practice.kind`-style reads would not catch a hand-rolled
  re-implementation of the exclusion walk; this needs to be checked by
  reading the actual exclusion code, or by a fixture-driven test (C7), not by
  a text scan alone.
- [x] **Vacuous / name-overclaiming guard — §9.3, including its new
  NAME-OVERCLAIMING GUARD sub-shape (opened by `DEC-S4-2` on this exact
  route).** D4's current form is the sub-shape's namesake: a real, passing
  assertion whose name ("atomic") is a superset of what it actually checks.
  The plan requires D4 to be **rewritten** (not extended) and **red-proven
  by mutation, by someone other than its author**, before step 3 lands. This
  is the single highest-value invariant in this change set and the plan
  handles it correctly on paper — build-time verification is the open item.
- [x] **Hand-scoped structural scan — §9.7.** G-A/G-B are specified to
  derive their file scope via `scanFiles(serverDir, ...)` rather than a
  hand-typed list, which is the compliant shape. A concrete premise-drift was
  found on G-B during this pass — see Open Questions (non-blocking, but
  needs a disposition before G-B is written).
- [x] **Overloaded absence — §9.8.** A re-parent cycle makes every member of
  the cycle vanish from `roots` (and therefore from the ledger, the picker,
  and the snapshot) with no error anywhere — `DEC-S4-7` names this explicitly
  and the plan's mitigation is two-layered (server rejects the cycle; UI
  excludes it from the picker), which is the right shape per this catalog
  entry's "structural cure first, corruption doesn't get a UI-only guard"
  rule. Test **P5** exercises the server half; **C7** exercises the UI half.
  Confirm at build that P5 uses a real 3-level fixture (grandparent
  re-parented under grandchild), not a 2-level one that can't actually prove
  a cycle rejection.
- [ ] **Round-trip / partial-update integrity (general invariant, not
  catalog-specific).** `updateProjectPlanItem`'s existing five fields use a
  `COALESCE`-based "absent means unchanged" idiom; the new `parent_item_id`
  field explicitly does **not** use that idiom (COALESCE can't express
  promote-to-top-level) and instead uses `Object.hasOwn` intent-detection.
  Two different "no-op" semantics now coexist in one function — worth a test
  making sure an update that touches *only* `text` truly leaves
  `parent_item_id` untouched (test **P3**, already specified) and that the
  reverse also holds (an update that touches only placement leaves `text`
  untouched — not explicitly named as its own case in §5, worth confirming
  it's covered inside P1/P2 rather than assumed).

## Tests already changed in this set
None — no code exists yet. The technical plan *specifies* test changes
(D4 rewrite, new D4b, P1-P7, G-A, G-B, C1-C7) as part of the implementation
steps; none of these files have been touched on `master`. This QA pass is
evaluating the **planned** test surface, not an actual diff.

## Stated intent / acceptance
From `supporting/product-owner.md`'s AC list (as narrowed by `DEC-S4-3`):
- **AC-8** — item/sub-item creation is real and in-panel, open plans only.
- **AC-9** — item/sub-item editing covers `text` and hierarchy placement
  (not `acceptance`/`detail`/`target_date` — deferred, `WATCH-S4-B`).
- **AC-10** — one hierarchy renderer, reused by the picker, not re-derived.
- **AC-13** — the single-claim gesture is behavior-unchanged except for the
  picker's new hierarchy rendering; response shape, status codes, and error
  strings are byte-identical to `master`.
- **Definition of Done (`technical-plan.md` §8)** is the authoritative
  acceptance checklist for 4a; it additionally requires the atomicity fix be
  mutation-proven by someone other than its author, both single-writer guards
  be mutation-proven, and all four locales carry identical key sets.

## Open questions

**Blocking (cannot plan tests without an answer):**
- None. The change set is fully specified, self-consistent across
  `technical-plan.md` / `pm-plan.md` / `decisions.md` /
  `decisions-tech-lead-addendum.md`, and every "confirmed live" claim in
  `technical-plan.md` that this pass spot-checked against the actual tree
  held (see verification notes below). Nothing here prevents the team from
  writing the specified test suite.

**Non-blocking (proceeding on a written assumption, or flagged for the next
stage to resolve before writing the specific artifact named):**
- **G-B's "exactly one lexical call site" claim for
  `insertProjectPlanItem.run(` is false on `master` today, confirmed live.**
  Two lexical call sites already exist in `plan-lifecycle.js`: line 141
  (inside the `insertProjectPlanItem` function itself — the canonical path)
  and line 269 (inside `importLegacyPlan`'s `doImport`, the legacy
  `AGENT-PLAN.md` import path, which calls the raw prepared statement
  directly, bypassing the `insertProjectPlanItem` function). This is
  pre-existing, legitimate, and unrelated to anything 4a builds — but if G-B
  is implemented literally as specified in `technical-plan.md` §5
  ("`insertProjectPlanItem\s*\.\s*run\s*\(` … exactly one lexical call
  site"), it fails on day one for a reason that has nothing to do with the
  re-parent capability it's meant to guard. Per this project's own §9.3
  history, a guard that goes red for a legitimate reason on day one gets
  *weakened*, not fixed, unless someone names the exception before it's
  written. → **Assumption for planning purposes:** the test-architect gives
  G-B a named, dated exception for the `importLegacyPlan` call site (the
  `GRANDFATHERED_QUERIES` / `FILE_DISPOSITIONS` pattern this project already
  uses elsewhere) or scopes the regex/target to exclude it, before writing
  the guard — not a redesign of the change, just a one-line correction to a
  test spec's stated premise.
- The working tree currently has an uncommitted, unrelated 65-line edit to
  `PROJECT-CONTEXT.md` (confirmed via `git status` — matches the plan's own
  disclosure of a concurrent session holding that file) plus in-progress work
  under `2026-08-06-auto-group-proposal/` and `2026-08-06-session-summary/`.
  → Assumption: this is the concurrent-session situation the plan's step 1
  already accounts for (`ps`/`lsof` + confirm-with-Sara before any git
  operation); not a blocker for *planning* tests, only for *executing* the
  branch-cut step. No action needed from this QA pass.
- P3 (existing-field regression when only `parent_item_id` is present) is
  explicitly listed; the mirror case (only `text` present, placement
  untouched) is not named as its own row in §5. → Assumption: it's intended
  to be covered by P1/P2's setup (both presumably assert only the touched
  field moved), not a real gap — flag for the test-architect to confirm
  explicitly rather than assume.
- `WATCH-S4-F` (no delete UI) and `WATCH-S4-G` (no reorder UI) are both
  correctly-scoped deferrals with named triggers, not gaps in 4a's own
  surface — no test coverage expected for either in this pass.

## Verification notes (spot-checks performed this pass, all confirmed)
- `updateProjectPlanItem` (`server/lib/plan-lifecycle.js:156`, prepared
  statement `server/db.js:3349`) destructures only
  `{ text, acceptance, detail, checked, position }` and its `SET` list has no
  `parent_item_id` — confirmed, matches the plan's Override 1.
- `POST /:id(\d+)/claims` (`server/routes/project-plans.js:479-575`) has no
  `dbModule.db.transaction(...)` anywhere in the handler — confirmed, matches
  `DEC-S4-2`'s finding.
- `client/src/lib/api.ts`'s `updateItem` (~line 2923) already types
  `parent_item_id: number | null` — confirmed, matches Override 1's "the
  client contract is already lying" claim.
- `buildItemTree` (`PlanLedgerPanel.tsx:266`), `ItemNodeRow` (:278), the
  `closed` gate (:334), `targetItemId` (:486), and `openItems` (:972) line
  references in the plan all match current source.
- `insertValueClaim.run(` has exactly one production call site today
  (`server/routes/project-plans.js:549`) — consistent with G-A's premise.
- `insertProjectPlanItem.run(` has **two** production call sites today
  (`server/lib/plan-lifecycle.js:141` and `:269`) — **inconsistent** with
  G-B's stated premise; see Open Questions.

## Verdict
**READY.**
