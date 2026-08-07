# Unit / Parity Test Design — plan-editing-ui (Value Pool Slice 4, Phase 4a)

> Authored by `qa-unit-architect`. Designs the fast/deterministic layer only
> (`node --test` server side, Vitest + Testing Library client side). Does not
> write product tests — a later implementation step does. Grounded in
> `technical-plan.md` §3-§5, `qa/change-brief.md`, and the live source tree
> (`server/lib/plan-lifecycle.js`, `server/routes/project-plans.js`,
> `server/db.js`, `server/lib/cwd-identity.js`,
> `client/src/components/PlanLedgerPanel.tsx`, and the three existing test
> files this change extends).

This project's frameworks: **server** = `node:test` + `node:assert/strict`
(`server/__tests__/*.test.js`, run via `node --test server/__tests__/*.test.js`
/ `npm run test:server`); **client** = Vitest + `@testing-library/react`
(`client/src/**/__tests__/*.test.tsx`, run via `cd client && npm test` /
`npm run test:client`). No new framework needed.

---

## 1. Server — `server/__tests__/project-plans-api.test.js` (Group D)

### D4 — REWRITTEN (not extended). §9.3 NAME-OVERCLAIMING GUARD fix.

**File:** `server/__tests__/project-plans-api.test.js`, replacing the current
D4 block (lines 494-523 today).

Current D4's defect is the exact §9.3 **NAME-OVERCLAIMING GUARD** instance
`decisions.md`'s `DEC-S4-2` names: its failure fixture is
`new_item: { text: "" }`, rejected by `insertProjectPlanItem`'s own
`text is required` guard **before any row is inserted**. The test's name
says "atomic" but only ever proves a *pre-insert* validation short-circuit —
it would pass unchanged even if `claimUnitIntoItem` had no transaction at
all, and it has never been observed failing against code that lacks one.

Split it into two honest, narrower cases:

```js
it("D4: new_item happy path creates the item and the claim", async () => {
  // valid new_item + valid claim fields -> 201; the returned claim.item_id
  // resolves to an item with the submitted text. (Unchanged from today's
  // passing half of the old D4 — kept as a regression pin.)
});

it("D4-empty-text: new_item with empty text is rejected by insertProjectPlanItem's own input guard — not evidence of atomicity", async () => {
  // new_item: { text: "" } -> 400 INVALID_INPUT; item count unchanged.
  // This is the OLD D4's fixture, kept verbatim, honestly renamed and
  // no longer claiming to prove atomicity.
});
```

### D4b — NEW, and relocated per a corrected premise (flagged explicitly, see below)

**§5 as literally written asks for:** "valid `new_item` + a `value_ref`
that collides with an existing claim on the same `(value_source, value_ref,
source_cwd, item_id)` → 409 `DUPLICATE_CLAIM` and no orphan item."

**This fixture is unreachable over HTTP, and this design pass caught it
before build time** — parallel in kind to the change brief's own G-B
call-site-count correction. The `UNIQUE` index's key includes `item_id`.
`project_plan_items.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`
(`server/db.js:770`), so SQLite never recycles a row id, and a `new_item`
claim's `item_id` is therefore always freshly minted and can never already
appear in an existing `value_claims` row. Combined with `DEC-S4-2`'s own
required reordering (§3.2 step 2: validate `value_source`/`attribution`/
`value_ref` **before** the transaction opens), every other in-transaction
failure this composer could hit is also closed off before the transaction
starts: `value_source`/`attribution` are `CHECK`-constrained but
pre-validated in JS; `value_ref` is `NOT NULL` but pre-validated in JS;
`source_cwd`'s `canonicalizeCwd` is documented to **never throw** (falls
back to its input on `ENOENT`, per its own doc comment in
`server/lib/cwd-identity.js:24-39`); `plan_id`/`project_id`/`item_id`'s FK
targets are all already resolved by the time `insertValueClaim.run` is
called. **Net result: once `DEC-S4-2`'s reordering lands, a `new_item`
claim has no naturally-occurring, HTTP-reachable post-item-insert failure
left to fail on.** The transaction is still correct and still required —
it guards against a genuine SQLite/OS-level failure (disk full, a future
added constraint) — but proving that guard needs a forced failure, not a
found one.

**Resolved design — split the atomicity proof across two files, by what
each is actually capable of exercising:**

1. **`server/__tests__/project-plans-api.test.js` — D4b, HTTP-level,
   proves the *reachable* half of `DEC-S4-2` (item-vs-existing-item
   duplicate, no new item involved):**
   ```js
   it("D4b: item_id (not new_item) claim duplicate still returns 409 DUPLICATE_CLAIM with no item-table side effect", async () => {
     // Seed: claim unit X into a pre-existing item A (item_id: A.id).
     // Repeat the SAME (value_source, value_ref, source_cwd, item_id: A.id)
     // claim -> 409 DUPLICATE_CLAIM, byte-identical message to D2's.
     // Assert item count is unchanged (nothing was ever created on this
     // path -- this is the "no side effect on an unrelated table" half,
     // not a rollback proof, since there is no item insert to roll back
     // here). This intentionally reuses D2's shape; it is retained here
     // because DEC-S4-2's DoD explicitly requires D4b to exist as a named
     // case, and this is the only genuinely HTTP-reachable "duplicate via
     // the claims route" fixture left once the new_item/UNIQUE path is
     // ruled unreachable.
   });
   ```

2. **`server/__tests__/plan-lifecycle.test.js` — the real atomicity proof,
   composer-level, forced failure (this is the test that actually earns
   the Definition of Done's "atomicity fix is red-proven by mutation"
   line):**
   ```js
   it("claimUnitIntoItem: a forced insertValueClaim failure after a new_item insert leaves no orphan item (DEC-S4-2 atomicity)", () => {
     // Call claimUnitIntoItem(dbModule, planId, { new_item: {text}, ...valid claim fields }) with dbModule.stmts.insertValueClaim.run WRAPPED for
     // exactly this one call to throw (e.g. a one-shot
     // `const real = dbModule.stmts.insertValueClaim.run; dbModule.stmts.insertValueClaim.run = () => { throw new Error("forced failure"); };`
     // restored in a `finally` / `after` so no other test is affected).
     // Assert the composer either throws (uncaught, non-UNIQUE path) or
     // -- if the fix wraps ALL insertValueClaim failures, not just UNIQUE,
     // in the transaction -- returns/throws consistently with its own
     // documented contract (confirm exact behavior against §3.2 step 4's
     // "catch outside the transaction, not inside it" wording: a NON-UNIQUE
     // throw is expected to propagate, not be swallowed into a domainError).
     // THEN: read dbModule.stmts.getProjectPlanItem.get(...) for the item
     // id the composer would have created (capture it via a spy on the
     // real insertProjectPlanItem call, or by asserting no NEW row exists
     // with the submitted text) and assert it is ABSENT — the item insert
     // was rolled back together with the failed claim insert.
   });
   ```
   This is the primary, load-bearing atomicity proof for the `new_item`
   path — put it in `plan-lifecycle.test.js` next to the P-cases (§2 below),
   since it exercises `claimUnitIntoItem` directly, the same way the
   P-cases exercise `updateProjectPlanItem` directly.

**Build-time note (not optional — read before implementing):** before
writing #1/#2 above, re-confirm `server/db.js`'s `value_claims` `CREATE
TABLE` (lines ~794-819) and `cwd-identity.js`'s `canonicalizeCwd`
(lines ~24-39) are unchanged from what this design read — if either gained
a new constraint or throw path since this design pass, a genuine
HTTP-reachable post-insert failure may now exist and should be **preferred**
over the forced-throw variant (HTTP-level is the project's general
integration-first bias; use the composer-level forced throw only when
nothing HTTP-reachable exists, as established here).

**Red-first (both #1 and #2):**
- #1 (D4b, HTTP): fails on `master` today for the SAME reason D2 already
  passes — i.e., #1 does **not** independently red-prove anything D2
  doesn't already prove. Its only distinct value is documentation/DoD
  compliance (a named `D4b`). Do not present it as red-first evidence for
  the transaction; #2 carries that weight.
- #2 (composer-level, forced throw): **this is the test that must be
  observed failing against unmodified `master`'s route code** (no
  `dbModule.db.transaction(...)` anywhere in the claim write path, per the
  change brief's own live spot-check of `server/routes/project-plans.js:479-575`).
  Against `master`, the forced `insertValueClaim.run` throw happens AFTER
  a real, committed `insertProjectPlanItem.run` call with no wrapping
  transaction — the item row **survives** the forced failure. Once
  `claimUnitIntoItem`'s transaction wraps both writes, the same forced
  throw rolls the item insert back too, and the test flips green. **This
  observation must be reported as actual command output in the build log,
  never as an intention** (§9.3 AGENT-SELF-REPORTED-RED, cited directly by
  `technical-plan.md` step 5) — and step 5's own mutation-proof (remove
  the transaction wrapper post-fix, watch this SAME test fail again,
  restore, re-run green) is this test, not a separate one.

### Regression (unmodified)

Every existing Group D case (D1, D2, D3, D5) must pass **without
modification** — the byte-identical / AC-13 acceptance signal. D3's "the
SAME unit claimed into a DIFFERENT item must be allowed" case is the one
most likely to be accidentally broken by a careless composer extraction (it
depends on the `UNIQUE` index's full 4-column key) — re-run it explicitly
after implementation step 3, not just as part of the full suite.

**Test data:** reuse `makeProject`/`post`/`fetch`/`del` helpers already at
the top of `project-plans-api.test.js`; D4/D4b need their own `before()`
seeding a fresh project + open plan (mirroring Group D's existing `before`
block at lines 396-406) so item-count assertions aren't polluted by other
Group D cases' inserts.

---

## 2. Server — `server/__tests__/plan-lifecycle.test.js` (new: P1-P7 + the atomicity case)

**File:** existing `server/__tests__/plan-lifecycle.test.js`, calling
`planLifecycle.updateProjectPlanItem` / `planLifecycle.claimUnitIntoItem`
directly (unit-level, not through Express) — read this file's current
top-of-file `before`/`beforeEach` before adding cases, to match its actual
DB bootstrap, not invent a new one.

All P-cases operate on `server/lib/plan-lifecycle.js`'s extended
`updateProjectPlanItem`, per `technical-plan.md` §3.2's four-step validation
chain (self-parent → parent-exists → same-plan → cycle) plus the
`Object.hasOwn`-gated intent detection (Override 1/2).

### P1 — re-parent a top-level item under another item

- Fixture: plan with two top-level items, A and B.
- Call: `updateProjectPlanItem(dbModule, A.id, { parent_item_id: B.id })`.
- Assert: returned row has `parent_item_id === B.id`; a fresh
  `getProjectPlanItem(A.id)` read confirms it persisted (round-trip
  through the DB, not just the in-memory return value).
- **Red-first:** on unmodified `master`, `updateProjectPlanItem` silently
  drops `parent_item_id` from `patch` (it destructures only
  `{ text, acceptance, detail, checked, position }`) — this call currently
  succeeds but leaves `parent_item_id` at its ORIGINAL value. Asserting the
  NEW value fails pre-fix and passes post-fix.

### P2 — promote a sub-item to top-level via explicit `null` (Override 2's own proof)

- Fixture: a fresh item C with `parent_item_id: B.id`.
- Call: `updateProjectPlanItem(dbModule, C.id, { parent_item_id: null })`.
- Assert: `parent_item_id === null` after the call, confirmed via a fresh
  DB read (`assert.equal(..., null)`, strict, not `!= B.id`).
- **This is the case a `COALESCE`-based statement cannot express.** If the
  build used `parent_item_id = COALESCE(?, parent_item_id)` instead of the
  planned narrow statement + `Object.hasOwn` gate, binding SQL `NULL`
  evaluates `COALESCE(NULL, parent_item_id)` to the EXISTING value —
  promotion silently no-ops. **Red-first:** a strict `=== null` assertion
  fails against a `COALESCE`-based regression and passes against the
  planned narrow-statement fix; a loose `!= B.id` assertion would not
  catch this regression (a no-op leaves `parent_item_id === B.id`, which
  IS `!= <anything else>` is the wrong direction — use strict equality to
  the expected new value, always).

### P3 — omitting `parent_item_id` leaves placement untouched while `text` still applies (existing-caller regression)

- Fixture: item D, `parent_item_id: B.id`, `text: "before"`.
- Call: `updateProjectPlanItem(dbModule, D.id, { text: "after" })` — the
  `parent_item_id` key is **genuinely absent** from the patch object
  (`{ text: "after" }`, not `{ text: "after", parent_item_id: undefined }`
  — the two are not equivalent to `Object.hasOwn` and must not be
  conflated in the fixture).
- Assert: `text === "after"` AND `parent_item_id === B.id` (unchanged).

### P3-mirror — the reverse case, explicitly (the change brief's named gap)

The change brief flags this as **not explicitly named** in
`technical-plan.md` §5 and asks for confirmation it's covered, not assumed.
**Resolution: its own explicit case.** Neither P1 nor P2 above asserts
`text` is unchanged, so nothing currently proves this direction.

- Fixture: item E, `text: "original text"`, `parent_item_id: B.id`.
- Call: `updateProjectPlanItem(dbModule, E.id, { parent_item_id: null })`
  — only placement in the patch, `text` key absent.
- Assert: `parent_item_id === null` AND `text === "original text"`
  (unchanged) — proving the five-field `COALESCE` idiom and the new
  `Object.hasOwn` idiom compose correctly in both directions.
- **Red-first:** low natural risk (`text != null ? text : null` is
  preserved verbatim by the plan), but pin it explicitly rather than leave
  it as an untested assumption — this is exactly the brief's own ask.

### P4 — self-parent → `INVALID_INPUT`, row unchanged

- Fixture: item F, top-level.
- Call: `updateProjectPlanItem(dbModule, F.id, { parent_item_id: F.id })`.
- Assert: `planLifecycle.isDomainError(result) === true`,
  `result.error.code === "INVALID_INPUT"`,
  `result.error.message === "an item cannot be its own parent"` (exact
  string, §3.2's validation-order text). Re-read F from the DB, assert
  `parent_item_id` unchanged.

### P5 — cycle via a real 3-level fixture (grandparent re-parented under grandchild)

**Confirm-at-build item named explicitly in the change brief** — must be a
genuine 3-level chain; a 2-level fixture only re-proves P4 under a
different name.

- Fixture: `G` (top-level) → `H` (`parent_item_id: G.id`) →
  `I` (`parent_item_id: H.id`). Three real rows, three real levels.
- Call: `updateProjectPlanItem(dbModule, G.id, { parent_item_id: I.id })`
  — re-parenting the grandparent under its own grandchild.
- Assert: `isDomainError === true`, `code === "INVALID_INPUT"`,
  `message === "parent_item_id would create a cycle"`. Re-read `G`, assert
  `parent_item_id` unchanged (still `null`).
- **Bounded-walk companion case** (§3.2: "Bound the walk by the plan's item
  count so a pre-existing corrupt row cannot hang the request"): construct
  a plan with a pre-existing corrupt self-referencing row (write it
  directly via a raw statement, bypassing validation, simulating legacy
  import corruption per `WATCH-S4-D`'s own disposition that the insert
  path stays shallow), then re-parent some UNRELATED item in the same
  plan. Assert the call terminates (does not hang) within a reasonable
  test timeout and does not throw an unbounded-recursion error — the walk
  must give up after at most `plan.items.length` hops.
- **Red-first:** on `master`, this call currently succeeds silently (no
  cycle check exists; `parent_item_id` isn't even read). An intermediate
  build that adds `reparentProjectPlanItem` but not yet the cycle check
  would ALSO succeed silently and corrupt the tree (Override 3: cycle
  members vanish from `roots`, §9.8 OVERLOADED-ABSENCE). Confirm both
  intermediate-red states during implementation, not just the final one.

### P6 — parent in a different plan → `INVALID_INPUT`

- Fixture: item J in plan 1; item K in a separate plan 2 (fresh
  `insertProjectPlan` + `insertProjectPlanItem` calls).
- Call: `updateProjectPlanItem(dbModule, J.id, { parent_item_id: K.id })`.
- Assert: `isDomainError === true`, `code === "INVALID_INPUT"`,
  `message === "parent_item_id belongs to a different plan"`. Re-read J,
  confirm unchanged.

### P7 — re-parent on a closed plan → `ALREADY_CLOSED`

- Fixture: a plan closed via `planLifecycle.closePlan`, with at least two
  items already in it (created before closure).
- Call: `updateProjectPlanItem(dbModule, itemInClosedPlan.id, { parent_item_id: otherItemInClosedPlan.id })`.
- Assert: `isDomainError === true`, `code === "ALREADY_CLOSED"`,
  `message === "plan is closed"` — confirm this is the SAME string the
  function already returns for other fields (`updatePlanTitle`'s analog at
  line 109 uses `"plan is closed"` too; grep to confirm
  `updateProjectPlanItem`'s own existing closed-plan guard, not just this
  new branch, uses the identical string before assuming it).
- Mostly a regression pin confirming the new placement logic lands AFTER
  the existing closed-plan guard (§3.2: "Add, after the existing
  closed-plan guard…"), not ahead of it.

### Atomicity case for `updateProjectPlanItem` itself (transaction wraps both writes)

§3.2: "Both writes (the existing field update and the re-parent) happen
inside one `dbModule.db.transaction(...)` so a rejected re-parent cannot
leave a partially applied text edit." Distinct from P1-P7's field-level
checks — deserves its own case:

- Fixture: item L, `text: "old text"`, top-level.
- Call: `updateProjectPlanItem(dbModule, L.id, { text: "new text", parent_item_id: L.id })`
  (self-parent — guaranteed rejection — combined with a text change in the
  same call).
- Assert: `isDomainError === true` (self-parent caught) AND re-reading L
  shows `text === "old text"` (not `"new text"`) — the rejected re-parent
  did not let the text edit through.
- **Red-first:** would silently regress if the 4-step validation ran AFTER
  `updateProjectPlanItem.run(...)` instead of before/inside the same
  transaction.

### Composer-level atomicity case for `claimUnitIntoItem`

See §1's D4b resolution above — the forced-`insertValueClaim`-throw test
belongs here, alongside these P-cases, since both exercise
`plan-lifecycle.js` functions directly rather than through Express.

**Test data:** all cases use small, per-case fixtures (2-4 items) built via
direct `planLifecycle.insertProjectPlan` / `insertProjectPlanItem` calls
against the file's existing DB setup — no shared cross-case state. Follow
the file's existing `beforeEach` pattern exactly rather than introducing a
second setup style.

---

## 3. Server — `server/__tests__/single-writer-guard.test.js` (new: G-A, G-B)

Both modeled on the existing `markValueUnitSummariesSeen` /
`requestValueCoverage` guards (current file, ~lines 285-385) — reuse
`scanFiles(serverDir, pattern)` and `stripComments(source)`, already
defined at the top of this file. **Do not** hand-type a file list (§9.7
HAND-SCOPED STRUCTURAL SCAN — the exact defect class this guard exists to
avoid reproducing in itself).

### G-A — `insertValueClaim` single lexical call site, inside `claimUnitIntoItem`

```js
it("insertValueClaim appears only in db.js and plan-lifecycle.js, with exactly one lexical call site tree-wide, inside claimUnitIntoItem", () => {
  const files = scanFiles(serverDir, /insertValueClaim/);
  const basenames = files.map((f) => path.basename(f)).filter((f) => !f.endsWith(".test.js"));
  assert.deepEqual(basenames.sort(), ["db.js", "plan-lifecycle.js"].sort());

  const libPath = path.resolve(serverDir, "lib/plan-lifecycle.js");
  const stripped = stripComments(fs.readFileSync(libPath, "utf8"));
  const callMatches = Array.from(stripped.matchAll(/insertValueClaim\s*\.\s*run\s*\(/g));
  assert.equal(callMatches.length, 1, "insertValueClaim.run( must have exactly one lexical call site tree-wide");

  // Confirm the one call site is lexically inside claimUnitIntoItem's body
  // (brace-depth walk, same technique as the existing enrichPoolAltitudes
  // check earlier in this same file).
});
```

**Red-first:** run against `master` today — `insertValueClaim.run(` already
has exactly one call site (`server/routes/project-plans.js:549`, per the
change brief's own live spot-check), so this guard currently asserts the
WRONG file set (`routes/project-plans.js`, not `plan-lifecycle.js`) — it
fails on `master` for the right reason (the write hasn't moved yet) and
goes green only once implementation steps 3-4 move the write into
`claimUnitIntoItem`. **Mutation-proof:** temporarily add a second
`insertValueClaim.run(...)` call anywhere else in `server/`, observe the
count assertion go red, revert.

### G-B — `project_plan_items` writers, single lexical call site each — with the confirmed two-call-site correction

**Apply the change brief's live-verified premise correction, not §5's
literal wording.** `insertProjectPlanItem.run(` has **two** real,
pre-existing, legitimate call sites on `master` today:
`server/lib/plan-lifecycle.js:141` (inside `insertProjectPlanItem`
itself — canonical) and `:269` (inside `importLegacyPlan`'s `doImport`,
the legacy `AGENT-PLAN.md` two-pass import, which intentionally bypasses
`insertProjectPlanItem`'s single-pass signature because it must insert all
items first, then resolve nesting once every legacy id maps to a real
one). A guard asserting "exactly one" is **red from the moment it's
written, for a reason unrelated to this phase's re-parent work** — the
exact §9.3 outcome this project's history says gets a guard *weakened*
rather than fixed, unless the exception is named up front.

**Design: a dated exception list, same shape as `GRANDFATHERED_QUERIES` /
`FILE_DISPOSITIONS` in `chronology-ordering.test.js` — reuse that pattern
rather than inventing a new one:**

```js
// KNOWN_MULTI_CALL_SITES: the ONLY insertProjectPlanItem.run( / lexical
// call sites permitted outside the canonical insertProjectPlanItem
// function body. A new entry here must be reviewed like this pair was —
// never widen this list silently to make a real new violation go away.
const KNOWN_MULTI_CALL_SITES = {
  insertProjectPlanItem: [
    {
      file: "server/lib/plan-lifecycle.js",
      context: "insertProjectPlanItem's own function body (canonical writer)",
    },
    {
      file: "server/lib/plan-lifecycle.js",
      context:
        "importLegacyPlan's doImport — the legacy AGENT-PLAN.md two-pass " +
        "import (insert-all-then-resolve-nesting), which cannot go through " +
        "insertProjectPlanItem's single-pass signature. Pre-existing, " +
        "unrelated to Slice 4a's re-parent capability.",
      dated: "2026-08-06",
    },
  ],
  reparentProjectPlanItem: [
    {
      file: "server/lib/plan-lifecycle.js",
      context: "updateProjectPlanItem's placement branch (the sole caller this phase adds)",
    },
  ],
};

it("insertProjectPlanItem.run( has exactly the two known, dated, reviewed call sites (canonical insert + legacy AGENT-PLAN.md import) and no others", () => {
  const files = scanFiles(serverDir, /insertProjectPlanItem/);
  const basenames = files.map((f) => path.basename(f)).filter((f) => !f.endsWith(".test.js"));
  assert.deepEqual(basenames.sort(), ["db.js", "plan-lifecycle.js"].sort());

  const libPath = path.resolve(serverDir, "lib/plan-lifecycle.js");
  const stripped = stripComments(fs.readFileSync(libPath, "utf8"));
  const callMatches = Array.from(stripped.matchAll(/insertProjectPlanItem\s*\.\s*run\s*\(/g));
  assert.equal(
    callMatches.length,
    KNOWN_MULTI_CALL_SITES.insertProjectPlanItem.length,
    `insertProjectPlanItem.run( call-site count drifted from the ${KNOWN_MULTI_CALL_SITES.insertProjectPlanItem.length} known, dated, reviewed sites — a NEW call site needs its own reviewed entry in KNOWN_MULTI_CALL_SITES, not a widened count`
  );
});

it("reparentProjectPlanItem.run( has exactly one lexical call site, inside updateProjectPlanItem's placement branch", () => {
  const files = scanFiles(serverDir, /reparentProjectPlanItem/);
  const basenames = files.map((f) => path.basename(f)).filter((f) => !f.endsWith(".test.js"));
  assert.deepEqual(basenames.sort(), ["db.js", "plan-lifecycle.js"].sort());

  const libPath = path.resolve(serverDir, "lib/plan-lifecycle.js");
  const stripped = stripComments(fs.readFileSync(libPath, "utf8"));
  const callMatches = Array.from(stripped.matchAll(/reparentProjectPlanItem\s*\.\s*run\s*\(/g));
  assert.equal(callMatches.length, 1);
  // brace-depth walk confirming the one call site is lexically inside
  // updateProjectPlanItem's body, same technique as G-A.
});
```

This gives G-B both required pins (`insertProjectPlanItem.run(` and
`reparentProjectPlanItem.run(`) while being honest about the pre-existing
second call site, instead of either (a) asserting a false "exactly one"
that's red on day one for an unrelated reason, or (b) silently scoping the
regex to dodge `importLegacyPlan` without a name/date/reason — both of
which this project's own §9.3/§9.7 history says are the wrong fixes.
**This exception needs explicit sign-off before it's written** — name it
in the build step's own commit message or PR description
(`DEC-S4-2`/`DEC-S4-7`-style traceability); it is a one-line correction to
a test spec's stated premise, not a redesign.

**Red-first for `reparentProjectPlanItem`:** fails on `master` today — the
function/statement doesn't exist yet, so `scanFiles` returns zero files
(`basenames` is `[]`, not `["db.js", "plan-lifecycle.js"]`). Goes green
only after implementation steps 6-7 land.

**Red-first for `insertProjectPlanItem`:** on `master` today, the count is
already 2 with the same two contexts this guard names — this specific
guard, written correctly with the two-entry exception list, is **already
green on `master`** (a pin on a pre-existing correct state, not a natural
red-then-green proof for this phase). Its mutation-proof is the only red
evidence available: **add a third call site** (a throwaway direct
`insertProjectPlanItem.run(...)` call anywhere else in `server/`), confirm
the count assertion goes red (`3 !== 2`), then revert. Document this
distinction in the test's own comment so a future reader doesn't mistake
"green on first run" for "unproven" — here it means "correctly describes
an existing state, proven by mutation instead of by natural red-then-green."

---

## 4. Client — `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (new: C1-C7)

**Naming collision, flagged for the implementer:** this file already has
`it("C1: marker distinct from every other state in the same render (§9.8)", ...)`
and `it("C2: explicit acknowledge …")` inside the existing freshness-marker
tests (lines ~552, ~740) — unrelated to this phase. Put the new cases in a
**separate `describe(...)` block**
(`describe("PlanLedgerPanel: item CRUD + hierarchy picker (Slice 4a, DEC-S4-3/S4-7)", ...)`)
so grep/`--test-name-pattern` output isn't ambiguous, while keeping the
exact `C1`…`C7` labels each `it(...)` string uses, since those are what
`technical-plan.md` and the Definition of Done both cite — describe-block
scoping is enough to disambiguate without renaming the plan's own labels.

**Mock setup needed (not yet in this file):** the existing
`vi.mock("../../lib/api", …)` block (lines 35-50) has no `addItem`/
`updateItem` mocks. Add `mockAddItemMock` / `mockUpdateItemMock` following
the exact pattern of `mockClaimMock`/`mockCloseMock` already there, wired
to `api.projectPlans.addItem` / `api.projectPlans.updateItem`.

### C1 — add-item form on an open plan creates a top-level item

- Fixture: one open plan, `makePlan()`, `items: []`.
- Setup: `mockAddItemMock.mockResolvedValue({ item: makeItem({ id: 30, text: "New top-level item" }) })`; sequence `mockListMock` so the post-submit
  refetch returns the plan WITH the new item (mirror the existing claim
  test's `mockResolvedValueOnce` sequencing at lines 236-243).
- Action: fill the `data-test="add-item-form"`'s text input (confirm the
  exact input `data-test`/label at build time — §3.5 names
  `add-item-form`/`add-item-submit` but not an input-specific one; query
  by placeholder/label text if no dedicated `data-test` exists), click
  `data-test="add-item-submit"`.
- Assert: `mockAddItemMock` called **exactly once** with
  `(plan.plan.id, { text: "New top-level item" })` — exact object match
  (not `expect.objectContaining`), so a stray `parent_item_id: undefined`
  key is caught, proving "no parent selected" omits the key entirely.
- Assert: after the refetch, `"New top-level item"` is visible in the
  plan's item tree.
- **Red-first:** fails on unmodified code — no add-item form exists at all
  (`data-test="add-item-form"` absent from the DOM), a hard failure to
  find the input/submit button, not a soft assertion miss.

### C2 — add-item with a parent selected; no add form on a closed plan

- **Part A (parent selected):** fixture with existing top-level item `P`
  (`id: 40`). Fill the text input, select `P` in the parent `<select>`,
  submit. Assert `mockAddItemMock` called with
  `(planId, { text: "...", parent_item_id: 40 })` — key present this time,
  exact match again.
- **Part B (closed plan, negative):** fixture a `status: "closed"` plan.
  Assert `data-test="add-item-form"`, scoped to that plan's section via
  `within`, is **absent from the DOM entirely** — not merely disabled.
  Matches §3.5's "reuse the existing `closed` prop gate… do not invent a
  second gate." Either extend the existing `"closed generation exposes no
  item-edit/claim/unclaim affordances"` test (line 357) with this
  assertion, or add Part B right next to it — do not duplicate the whole
  closed-plan fixture setup a third time in the file.
- **Red-first:** Part A fails pre-change (no parent select exists). Part B
  is a real regression risk the moment C1's form exists — before the
  `closed` prop is threaded to the new form it would render unconditionally
  (test fails); once §3.5's gate is wired, it passes.

### C3 — the named §9.1 cross-consumer equality check (AC-10). Highest-value client test in this set.

**Must be equality between the two consumers, not two independent
per-component assertions** — the plan's own explicit acceptance shape and
the change brief's stated confirm-at-build item.

- Fixture: a 3-level tree — root `R` (`id: 50`), child `Citem`
  (`id: 51, parent_item_id: 50`), grandchild `Gitem`
  (`id: 52, parent_item_id: 51`) — plus a sibling root `R2` (`id: 53`) so
  ordering is meaningful.
- Step 1 (initial render): render with `plan.items = [R, Citem, Gitem, R2]`.
  Derive `{ id, depth }[]` from BOTH consumers:
  - The read-only `ItemTree`'s row order/depth — derive depth from
    `ItemNodeRow`'s rendered `paddingLeft` (`depth * 16`, line 280) or from
    a `data-depth={depth}` attribute if the build step adds one (a
    one-line, harmless, test-motivated addition worth suggesting, not
    required — depth is derivable from indentation either way; confirm the
    exact row selector against the live component at build time).
  - The claim `<select>`'s (or the new add/edit parent `<select>`'s)
    `<option>` order/depth — parse each option's `"  ".repeat(depth) + "└ "` prefix (§3.5's exact format) for `depth`, and its `value`/text for `id`.
  - **Assert the two derived arrays are `deepEqual`** — one assertion over
    two arrays, not per-node `toBeInTheDocument()` calls.
- Step 2 (reorder the input, assert both change identically): re-render
  with `plan.items` in a DIFFERENT array order (e.g.
  `[R2, Gitem, R, Citem]` — same tree, shuffled array). Re-derive both
  arrays. Assert:
  - Both are **identical to Step 1's** (array order must not leak through
    either consumer — `buildItemTree` derives structure from
    `parent_item_id` alone).
  - The two consumers' arrays **still equal each other** — the assertion
    that specifically catches a hand-rolled second nesting function that
    happens to agree with `buildItemTree` on the FIRST fixture by
    coincidence but diverges once input order changes. This is why Step 2
    exists at all; a single-fixture equality check is not sufficient per
    §9.1's own catalogued history.
- **Red-first:** fails today — the claim `<select>` renders `openItems` in
  raw array order with no depth/indentation (lines 578-582), so depths
  can't even be parsed (the comparison is trivially unequal, or the parse
  throws — treat a throw as a failure, not a skip). Passes once
  `flattenItemTree(buildItemTree(...))` backs both consumers per §3.5.

### C4 — sub-item claiming + the stale-target fix

- **Part A (claim into a sub-item):** fixture a top-level item with a
  sub-item; render with a pool unit present. Select the SUB-item in the
  claim `<select>`, click claim. Assert `mockClaimMock` called with
  `("proj-1", subItem.id, unit)` — the sub-item's real id.
- **Part B (stale-target / zero-to-one items, the §3.5 fix):** fixture a
  plan with `items: []` and a pool unit present. Assert the claim control
  is entirely absent (`openItems.length > 0` gate). Then simulate the
  add-item flow producing the plan's first item — via `mockAddItemMock` +
  a `list()` refetch returning the plan with one item, same re-render, NO
  remount. Assert the claim control now renders AND its button is enabled
  without any additional interaction — proving `effectiveTargetId`'s
  render-time fallback works with no manual re-select. **One render
  lifecycle only** — do not call `render()` a second time; that would
  trivially "pass" a component that never implements the fallback.
- **Red-first:** Part A is mainly a regression pin (today's raw-array
  `openItems` already lets a sub-item be selected; confirm
  `flattenItemTree` doesn't silently break that). Part B is the real
  red-before/green-after case: on unmodified code, `targetItemId` is
  `useState(openItems[0]?.id ?? null)`, initial-value-only (line 486) —
  after adding a first item to a previously-empty plan, it stays `null`
  and the claim button stays disabled. Must be observed failing before the
  `effectiveTargetId` fallback lands.

### C5 — edit-in-place, text only, "absent means unchanged" on the wire

- Fixture: item `id: 60`, `text: "old text"`, open plan.
- Action: click `data-test="item-edit-button"`, change
  `data-test="item-edit-text"` to `"new text"`, click
  `data-test="item-edit-save"` WITHOUT touching the parent `<select>`.
- Assert: `mockUpdateItemMock` called with `(60, { text: "new text" })` —
  exact object match, **no `parent_item_id` key present at all** (not
  `undefined`, not `null` — genuinely absent). This is the client half of
  §3.4's wire contract ("absent key" means "don't touch placement").
- **Red-first:** fails pre-change — no edit-in-place UI exists
  (`data-test="item-edit-button"` absent).

### C6 — re-parent via edit; promote-to-top-level sends explicit `null`

- **Part A (re-parent to another item):** C5's fixture plus item `id: 61`
  as the new parent. Edit item 60, select item 61 in
  `data-test="item-parent-select"`, save. Assert `mockUpdateItemMock`
  called with `(60, { …, parent_item_id: 61 })` — confirm at build time
  whether the form always sends `text` alongside `parent_item_id`; assert
  whatever the real shape is, exactly (no silent extra keys).
- **Part B (promote to top-level, explicit `null`):** fixture item
  `id: 62`, `parent_item_id: 60` (a sub-item). Edit it, select the
  "top-level" option, save. Assert `mockUpdateItemMock` called with
  `parent_item_id: null` **explicitly present and `null`** — the one case
  where a key must be present despite looking like "nothing." This is the
  case a careless `parent_item_id: selectedValue || undefined` implementation
  (coercing a "top-level" sentinel into `undefined`) would silently break.
  Client-side mirror of P2's server-side "`COALESCE` can't express this"
  proof — review them together.
- **Red-first:** both parts fail pre-change (no edit-in-place UI). Part B
  additionally guards against the specific near-miss above during review —
  there is no isolated intermediate build step that has exactly this bug
  in isolation to run against, so treat this as a review-time check on top
  of the automated red-before/green-after.

### C7 — parent `<select>` excludes self + all descendants; current-plan-only

**The §9.1 "rogue re-derivation, not just rogue reading" corollary the
change brief names explicitly** — must be a fixture-driven proof, not a
source-text scan for `parent_item_id` (a text scan would miss a
re-derivation that still happens to read `ItemNode.children`-shaped data,
or false-flag an unrelated string).

- Fixture: a **4-level** tree — `R` → `Citem` → `Gitem` → `Hitem` (add the
  4th level specifically so the exclusion has a grandchild to fail on, not
  just a direct child) — plus unrelated top-level `R2`, all in plan A. Add
  a second plan B with its own item `X`.
- Action: open edit-in-place on `Citem` (the middle node — has both an
  ancestor, `R`, and descendants, `Gitem`/`Hitem` — most likely to expose
  an incomplete walk).
- Assert, reading `data-test="item-parent-select"`'s options for that row:
  - `Citem` itself absent (no self-parent).
  - `Gitem` (direct child) absent.
  - `Hitem` (**grandchild**) also absent — the case a shallow
    "`node.children` only, not full subtree" bug would miss.
  - `R` (ancestor), `R2` (unrelated sibling), and a "top-level" sentinel
    option ARE present — the exclusion is scoped, not over-broad.
  - `X` (plan B's item) is absent — the picker is scoped to "this plan
    only," independent of the self/descendant exclusion.
- **Red-first:** fails pre-change (no edit-in-place UI at all). Once it
  exists, review-check the near-miss "excludes only direct `children`, not
  the full subtree" implementation against THIS test's grandchild
  assertion specifically — a 2- or 3-level fixture would not catch it.

### Regression: the existing claim test's assertion shape, unmodified

The existing `"calls api.projectPlans.claim exactly once with (itemId, unit)"` test (line 230) must keep passing with `mockClaimMock` called as
`("proj-1", item.id, unit)` — unchanged 3-argument shape. `openItems`'
element type widens (gains `depth`, `planId`) per §3.5, but this test's own
fixture (`makeItem()` default, single top-level item, `depth === 0`)
should not need edits — re-run it explicitly after implementation step 9
(`flattenItemTree`/`openItems` rebuild) and confirm it passes UNMODIFIED,
per that step's own checkable item.

**Test data:** extend the existing `makePlan`/`makeItem`/`makeUnit`
factories — no parallel factories. `makeItem()` already supports
`parent_item_id` (default `null`, line 83) for building multi-level trees.

---

## 5. Round-trip / boundary coverage

- **`parent_item_id` write/read round-trip** is covered by P1/P2/P3/
  P3-mirror (§2 above) across every reachable value (a real item id,
  explicit `null`, and "absent = unchanged") — this IS the round-trip
  surface for this change; no separate round-trip test is needed since
  `project_plan_items` gains no other persisted field in this phase
  (`DEC-S4-3`: only `text` and `parent_item_id` are in scope;
  `acceptance`/`detail`/`target_date` deferred, `WATCH-S4-B`).
- **No unresolved-placeholder risk applies** — this change has no
  templated string/token surface bound for an external renderer. Not
  applicable; noted for completeness, not skipped silently.
- **Claim atomicity (the composer-level test in §2 / D4b in §1) is itself
  the boundary-surface test** — `value_claims` and its owning
  `project_plan_items` row cross a transaction boundary together; "item
  row absent after rollback" / "claim count unchanged" are the round-trip
  proof for that boundary (a failed write must leave BOTH tables exactly
  as they were, not just the one the error message names).

---

## 6. How to run

```
npm run test:server
npm run test:client
node --test server/__tests__/project-plans-api.test.js
node --test server/__tests__/plan-lifecycle.test.js
node --test server/__tests__/single-writer-guard.test.js
cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx
bash .claude/skills/file-headers/scripts/check-headers.sh
```

(Exact commands from `technical-plan.md` §5, reproduced here for the
implementer's convenience.)

---

## 7. Red-first summary table

| Test | Fails before fix because… | Passes after because… |
|---|---|---|
| D4 (happy path + relabeled empty-text) | N/A — regression pin, already passing; kept honest by rename only | Unchanged behavior, honestly labeled |
| D4b (HTTP, item_id duplicate) | N/A — reuses D2's already-reachable shape; documents DoD compliance, not new red-proof | — |
| `claimUnitIntoItem` forced-throw atomicity case (`plan-lifecycle.test.js`) | route has no `dbModule.db.transaction(...)`; a forced post-item-insert throw leaves the item row committed | `claimUnitIntoItem`'s single transaction rolls the item insert back together with the failed claim insert |
| P1 | `updateProjectPlanItem` never reads `parent_item_id` from `patch` at all | new `Object.hasOwn`-gated branch + `reparentProjectPlanItem` write |
| P2 | same as P1, and a naive `COALESCE`-based fix would silently no-op promote-to-null | narrow statement + explicit-`null` handling (Override 2) |
| P3 / P3-mirror | field is currently ignored entirely (passes trivially, for the wrong reason); real proof is P1/P2 flipping while P3 stays green throughout | absent-key detection via `Object.hasOwn`, not `!= null` |
| P4 | no self-parent check exists | step 1 of the 4-step validation chain |
| P5 | no cycle check exists; a cycle silently corrupts `roots` (§9.8 OVERLOADED-ABSENCE) with zero error | step 4 of the 4-step validation chain |
| P6 | no same-plan check exists | step 3 of the 4-step validation chain |
| P7 | regression pin — closed-plan guard already exists for other fields | confirms the new placement branch runs after/inside the existing guard |
| `updateProjectPlanItem` atomicity case | would regress if validation ran after the write instead of before/inside one transaction | validate-then-write ordering inside one transaction |
| G-A | write lives in the route today, not `plan-lifecycle.js`; scan finds the wrong file set | write extracted into `claimUnitIntoItem` (steps 3-4) |
| G-B (`reparentProjectPlanItem`) | statement/function don't exist yet; scan returns zero files | steps 6-7 add them |
| G-B (`insertProjectPlanItem`) | N/A — already correctly 2 call sites; mutation-proven pin, not a natural red→green | mutation-proof: injected 3rd call site goes red, reverts to green |
| C1 | no add-item form in the DOM | §3.5 `PlanSection` add-item form |
| C2 | no parent picker on add; closed-plan gate not yet wired to the new form | §3.5 form + reused `closed` gate |
| C3 | claim `<select>` has no depth/indentation, raw array order, not comparable to `ItemTree` | `flattenItemTree(buildItemTree(...))` backs both consumers |
| C4 (Part B) | `targetItemId` is initial-value-only; stays `null`/disabled after first item is added to an empty plan | `effectiveTargetId` render-time fallback |
| C5 | no edit-in-place UI | §3.5 `ItemNodeRow` edit-in-place, text-only save |
| C6 | no edit-in-place UI; a naive impl could send `undefined` instead of explicit `null` for "top-level" | edit-in-place + explicit-`null` promote path |
| C7 | no edit-in-place UI; a shallow exclusion (direct children only) would leak a grandchild into the picker | full-subtree exclusion walk over materialized `ItemNode.children` |

---

## 8. Open items this design pass is flagging forward

1. **D4b's HTTP-reachability finding is a correction to `technical-plan.md`
   §5, not an open question — it is resolved above** (§1): the literal
   `new_item` + `UNIQUE`-collision fixture is unreachable given
   `AUTOINCREMENT` item ids and `DEC-S4-2`'s own required validation
   reordering. The real atomicity proof moves to a composer-level forced
   throw in `plan-lifecycle.test.js`; `D4b` in `project-plans-api.test.js`
   is retained only as a named, DoD-compliant HTTP case reusing D2's
   already-reachable duplicate shape. **Re-confirm this reasoning at build
   time** if `value_claims`'s schema or `canonicalizeCwd` have changed
   since this design pass — see §1's "Build-time note."
2. **G-B's two-call-site exception needs explicit sign-off** (named in the
   PR/commit, per the `GRANDFATHERED_QUERIES`/`FILE_DISPOSITIONS`
   precedent) before the guard is written — a one-line correction to a
   test spec's stated premise, not a redesign, but must be a named, dated
   decision, not a silent scope-narrowing.
3. **C3's exact DOM selectors** (the `ItemTree` row selector; whether to
   add a `data-depth` attribute) need a build-time read of the live
   component's rendered markup. This design specifies the assertion shape
   precisely (derived `{id, depth}` array equality, both directions,
   before AND after reordering the input) — it leaves selector mechanics
   to build time since they don't change the invariant being proven.
