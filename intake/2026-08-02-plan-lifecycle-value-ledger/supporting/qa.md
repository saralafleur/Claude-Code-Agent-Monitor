# QA / Test Architecture — Plan lifecycle + value ledger

**Intake item:** `intake/2026-08-02-plan-lifecycle-value-ledger/`
**Prepared:** 2026-08-02 (intake-qa, auto-pilot run — everything below is a
best-recommendation, clearly marked where a choice was made for the team)
**Test stack (verified):** server = `node:test` in `server/__tests__/*.test.js`
(`npm run test:server`; single spec: `node --test server/__tests__/<spec>.test.js`);
client = vitest + RTL in `client/src/**/__tests__/` (`npm run test:client`;
snapshots regenerated with `cd client && npx vitest run -u`, reviewed, never blind).

**Baseline pass state (verified 2026-08-02):** the nine existing specs on this
surface — `plan-ingest`, `plans-api`, `plan-writeback`, `detour-disposition`,
`db-migration`, `reconciliation-full-tick`, `chronology-ordering`,
`single-writer-guard`, `pace-tracking` — run green together: **144/144 pass**.
That is the regression floor; nothing in this build may leave any of them red
or weakened (no new `GRANDFATHERED_QUERIES` entries without a dated reason,
no loosened scan scope).

---

## 1. How we verify "done"

The request's four parts each get a concrete, runnable check. The acceptance
sketch in `request.md` maps to these directly.

### Part A — Plan lifecycle
- **Automated:** a lifecycle spec proves: create plan → open; multiple plans
  open concurrently on one cwd; close is a deliberate action that stamps
  `closed_at` + closure annotation; a closed plan is immutable (no item edits,
  no reopen unless designed, no delete path exists at all); history query
  returns all generations for a project.
- **Manual:** in the dashboard, open two plans on one project simultaneously,
  close one, see it leave the active pane and appear in history with its stamp.

### Part B — Unclaimed value pool
- **Automated:** pool assembly against **real throwaway git repos** (the
  established `intake-scan.test.js` / `repo-topology.test.js` fixture pattern
  — real `git init`/`commit`/`merge`, `ISOLATED_GIT_ENV` stripping, never
  mocked child_process): a `Merge effort/<slug>:` merge commit lands in the
  pool tier `mechanical` attributed to the matching intake initiative; a
  direct-to-trunk commit bracketed by a seeded focus segment lands as
  `correlational`; an unbracketed one lands unattributed (`judgment` tier is
  proposal-only, human-gated — assert nothing auto-claims from it).
- **Manual:** open the Coaching Assistant project (the request's origin case),
  confirm its trunk commits and initiatives appear in the pool with sane tiers.

### Part C — Two-pane reconciliation workbench
- **Automated (client):** RTL spec: left pane renders open plans (plural) with
  nested items; right pane renders the pool; the claim gesture calls the claim
  API with (value-unit id, plan item id) and the pool row disappears on the
  refreshed response; close-plan calls the close API; closed plan leaves the
  left pane. Plus a screen entry in `screens.snapshot.test.tsx`.
- **Manual:** the pull-right-to-left gesture feels usable on real data (this
  is the wip-queue-revert risk zone — see §6).

### Part D — Ledger
- **Automated:** claims persist across pool re-assembly byte-for-byte (the
  ratchet — see invariant I2); closing a plan marks exactly its claimed value
  closed and the pool count shrinks by exactly the claimed units; health
  metrics (pool size, time-since-last-closure) come from **one** shared
  computation and read identically on every consumer (see invariant I6).
- **Manual:** "what value did this project deliver" answered from the closed
  generations + claims view alone, with no repo archaeology.

---

## 2. Regression coverage (existing tests, discovered by grep — all currently pass)

| Surface | Existing spec | What it pins today | Risk from this build |
|---|---|---|---|
| Plan ingest | `server/__tests__/plan-ingest.test.js` (36 cases) | parse, re-ingest identity by `item_id`, **`deletePlanItemsNotIn` deleting rows absent from the file** ("preserves declared_done_* across re-ingest and deletes removed numbers") | DEC-P2 inverts this: "deletes removed numbers" becomes wrong behavior for DB-authored items. This spec must be **consciously updated**, not deleted — see T4. |
| Plans API + focus | `server/__tests__/plans-api.test.js` | `/api/plans` shapes, `plan_updated` WS type ("no new message type"), focus set/pop by `(cwd, item_number)` | Multiple plans per cwd breaks `plans` PK = `cwd` and the `(cwd, item_number)` uniqueness that focus-by-number typing relies on. |
| Write-back | `server/__tests__/plan-writeback.test.js` | `applyDisposition`, single-composer, backups, CRLF | DEC-P2 leaves this path's fate open. Whatever is decided, these tests are the record — retire/repurpose them **with** the code, in the same change. |
| Detours | `server/__tests__/detour-disposition.test.js`, `reconciliation-full-tick.test.js` | disposition transitions, full tick incl. byte-parity Scenario C | Detours become pool inputs; the existing flows must be untouched (DEC-P4: altitude). |
| Pace | `server/__tests__/pace-tracking.test.js` | `pace.js` over one plan per cwd | Must be re-pointed at "per plan" not "per cwd" without changing single-plan behavior. |
| Migration | `server/__tests__/db-migration.test.js` (`UPGRADE_CASES` + `GRANDFATHERED` registry) | legacy-shape seed → migrate → assert column/NULL/writable/no-op | Every new column goes through `UPGRADE_CASES`; the PK change needs more (§9.6 — T1). |
| Chronology | `server/__tests__/chronology-ordering.test.js` (static scan + `assertOrderedByCreatedAt` in `helpers/ordering.js`) | `ORDER BY created_at, id` before `LIMIT` in scanned files | New pool-assembly lib files are **outside the scan's file list** until added — §9.7's exact failure shape. |
| Single-home | `server/__tests__/single-writer-guard.test.js` | sole write-composer pattern, red-proven by rogue-injection | Template for the closure-path guard (T5). |
| Client | `client/src/pages/__tests__/ProjectDetail.test.tsx`, `client/src/components/__tests__/PlanPanel.test.tsx`, `PlanModal.test.tsx`, `screens.snapshot.test.tsx` | current plan surfaces render | Workbench UI placement (open question 4) decides whether these extend or a new page spec is born. |

---

## 3. Invariants that must hold (each gets a named negative test)

- **I1 — Closure invariant (DEC-P6).** Value reaches `closed` only via plan
  closure. Negative tests: no API route, no DB helper, no reconciliation tick
  can set a value unit closed directly; an unclaimed unit is untouched by any
  plan's closure; a claimed unit closes **iff** its plan closes.
- **I2 — Ratchet (claims never recomputed).** After a claim exists, re-running
  pool assembly (twice, and with the underlying git history grown) leaves the
  claim row byte-identical and never re-offers the claimed unit. Run #1
  baseline behavior is pinned to whatever open-question 2 decides — the test
  documents the decision either way.
- **I3 — Import inversion loses nothing.** With DB-authored items present,
  re-running the AGENT-PLAN.md import (or any residual ingest path) deletes
  zero DB-authored rows. Today `plan-ingest.js:396` calls
  `stmts.deletePlanItemsNotIn` unconditionally on every ingest — this is the
  single most likely silent-data-loss line in the build.
- **I4 — Migration safety on the shared user-global DB.** `plans` PK is `cwd`
  and `plan_items` FKs it — breaking one-plan-per-cwd is a **table rebuild**,
  not an `ALTER`. §9.5 + §9.6 apply in full: legacy-shape upgrade case AND an
  interruption case; the rebuild must be atomic (copy the `agents` site —
  verify by grep for `PRAGMA foreign_keys = OFF` / `BEGIN;` /
  `CREATE TABLE agents_new`, not by line number). **Best-recommendation
  (auto-pilot): build the §9.6-recommended `rebuildTableAtomically` helper as
  part of this change and make this rebuild a call site** — the PM already
  recommended exactly this on 2026-08-02 for the two CHECK-widening rebuilds
  in flight; a third hand-roll is the catalogued failure mode.
- **I5 — Concurrent plans don't break focus/pace/detour flows.** With two
  open plans on one cwd: `ccam focus set <n>` / `POST focus` still resolves
  deterministically (or fails loudly with a designed disambiguation — never
  picks silently); pace computes per plan; `applyDisposition`'s
  `resolved_item_id` back-pointer still lands on the right item. All existing
  specs in §2 stay green **unmodified except where the behavior change is the
  request** (each such edit named in the build notes).
- **I6 — Derived values single-home (§9.1).** Pool size and
  time-since-last-closure are computed in exactly one server function;
  workbench UI, `ccam`, MCP, and any AGENT-PLAN.md export consume that value.
  Cross-consumer parity test required **on day one** (the catalog's own
  history: the failure lands when consumer #2 appears, and DEC-P2 ships with
  ≥3 consumers).
- **I7 — Chronology (§9.2).** Every pool-assembly query walking `events` /
  focus tables orders by `created_at, id` before any `LIMIT`, proven with the
  scrambled-id fixture via `assertOrderedByCreatedAt`, and the new lib files
  are added to the static scan's file list (§9.7: scope derived, not
  hand-typed).
- **I8 — All structural guards red-proven (§9.3/§9.7).** Every guard above is
  shown to fail under mutation (rogue call site injected, ordering reverted,
  rebuild transaction removed) with the observation recorded, and the
  `assert.ok(true` / `|| true` sweeps stay at 0.

---

## 4. New / updated tests required (named specs — best-recommendation naming)

**T1 — `server/__tests__/db-migration.test.js` (extend).**
`UPGRADE_CASES` entries for every additive column; a rebuild case for the
`plans`/`plan_items` re-key that (a) seeds the **current** shape with live
data — focus pointers, `target_date`, `declared_done_*`, detour rows — and
asserts full survival as generation 1, (b) asserts second run is a no-op, and
(c) an **interruption test**: kill the migration mid-sequence (throw injected
between statements against a copy DB), reopen, assert the pre-migration state
is intact and the migration runs to completion on retry. Add the
`REBUILD_CASES` registry-completeness meta-test §9.6 recommends.

**T2 — `server/__tests__/plan-lifecycle.test.js` (new).**
Part A's state machine + I1's negative closure tests + I5's concurrent-plan
cases (focus resolution, pace per plan, disposition back-pointer). Fixture:
in-memory/tmp DB via the suite's standard harness, two open plans + one
closed generation seeded on one cwd.

**T3 — `server/__tests__/value-pool.test.js` (new).**
Part B via real tmp-dir git repos (`makeRepo` + `ISOLATED_GIT_ENV` pattern
from `intake-scan.test.js`): merge-commit slug attribution, focus-bracket
correlation, tier assignment, **ratchet across runs (I2)**, and I7's
scrambled-id chronology fixture. Also: add the new lib file(s) to
`chronology-ordering.test.js`'s scanned-file list in the same commit.

**T4 — `server/__tests__/plan-import-inversion.test.js` (new) + conscious
edit of `plan-ingest.test.js`.**
I3: DB-authored items survive import; AGENT-PLAN.md imports as generation 1
exactly once (re-import is a no-op, not a second generation); the
`deletePlanItemsNotIn` path is either removed or provably scoped to
file-owned generation-1 rows only. The existing plan-ingest case "preserves
declared_done_* across re-ingest **and deletes removed numbers**" must be
rewritten to the new contract deliberately — its diff is the review artifact
proving the inversion was thought through, not accidentally lost.

**T5 — `server/__tests__/value-ledger.test.js` (new).**
Part D: claim persistence, claim cardinality per the schema decision
(open question 3 — the test pins whichever is chosen), pool-shrink-on-close
accounting, and the **closure single-writer guard**: one function composes
the close-plan write (stamp + claims transition), scope derived from the
module's real exports per §9.7, red-proven by injecting a rogue second call
site per `single-writer-guard.test.js`'s template.

**T6 — `server/__tests__/ledger-metrics-parity.test.js` (new — the
"per-shape, not per-module" spec §9.1's QA note says never gets written).**
I6: drive one seeded DB state through the API route, the `ccam` CLI command,
and the MCP tool; assert the health-metric values are identical triples. If
the AGENT-PLAN.md export ships, it joins as consumer #4 here.

**T7 — client specs.**
`client/src/pages/__tests__/ReconciliationWorkbench.test.tsx` (or the
ProjectDetail extension, per open question 4): Part C's behaviors as listed
in §1. Plus the new screen registered in `screens.snapshot.test.tsx` with a
reviewed baseline. If health metrics render client-side, they consume the
server value — no client re-derivation (else a `windowedTotals.ts`-style
documented-bound header is mandatory).

**Run commands:** `npm run test:server`, `npm run test:client`; single specs
via `node --test server/__tests__/plan-lifecycle.test.js` /
`cd client && npx vitest run src/pages/__tests__/ReconciliationWorkbench.test.tsx`.

---

## 5. Test data / fixtures

- **Git:** real throwaway repos in `fs.mkdtempSync(os.tmpdir())` — one trunk
  with (a) `Merge effort/<slug>: …` merge commits matching seeded
  `intake/<slug>/` folder trees, (b) direct-to-trunk commits at controlled
  timestamps, (c) commits added **between** pool runs for the ratchet case.
  Copy the `ISOLATED_GIT_ENV` stripping verbatim.
- **DB:** the suite's standard tmp-DB harness; seed legacy shapes from
  literal `CREATE TABLE` SQL snapshots (the `UPGRADE_CASES.legacySql`
  pattern), never from current `db.js` — that's the whole point of §9.5.
- **Chronology trap:** insert events/focus rows so that `id` order and
  `created_at` order disagree (the `workflow-ingest` bulk-insert shape) before
  every pool-assembly assertion.
- **Client:** mocked `api.ts` responses shaped from the new wire types, two
  open plans + ≥3 pool units across all three confidence tiers, one closed
  generation for the history view.

---

## 6. Manual verification before sign-off (the DEC-7 precedent)

The prior effort's DEC-7 live-trial gate is the standing precedent: **a green
suite is not sign-off** on this surface — and that gate is itself still open.
Sequencing also carries the `wip-queue-page` revert scar: checkpoint with Sara
per slice, not one big reveal.

Sara's live trial, on her real data:
1. **Back up `~/.claude/agent-dashboard/dashboard.db` first** — the migration
   hits the shared user-global DB from whichever worktree boots first.
2. Boot the migrated dashboard; confirm existing surfaces (focus, pace,
   detours, Project Detail, decision queue) look unchanged before touching
   anything new.
3. Open the **Coaching Assistant** project (the request's origin case): real
   AGENT-PLAN.md imported as generation 1; pool shows its trunk commits and
   ~30 initiatives with believable attribution tiers.
4. Claim a handful of units (one mechanical, one correlational); create a
   retroactive detour-bundle plan; close it. Confirm the stamp, the history
   entry, and the pool shrinking by exactly the claimed units.
5. Answer "what value did this project deliver" from closed generations +
   claims alone. If that took archaeology, the request is not done regardless
   of suite state.
6. Restart the server; confirm claims and the closed generation survived and
   nothing re-imported or re-computed (I2/I3 in the wild).

---

## 7. Definition of Done checklist

- [ ] `npm run test:server` and `npm run test:client` green; the §2 baseline
      144 remain green with only request-mandated edits (each named).
- [ ] T1–T7 exist, pass, and every structural guard has a **recorded red
      state** (mutation described in the build notes) — §9.3.
- [ ] `plans`/`plan_items` rebuild is atomic with an interruption test;
      `rebuildTableAtomically` helper landed (or a dated decision why not).
- [ ] I3 proven: no DB-authored row deleted by any import/ingest path.
- [ ] Health metrics single-homed with the T6 parity test across all live
      consumers; new pool queries in the chronology scan's file list.
- [ ] Snapshot baselines reviewed (not blind-regenerated); WS message types
      backward-compatible or the new type documented in `docs/API.md`.
- [ ] `plan-writeback.js`'s fate decided and recorded in `decisions.md` with
      an id; its tests retired/repurposed in the same change.
- [ ] Every review-round finding ends as *fixed-with-a-test* or
      *recorded-in-decisions.md* (§9.4 — no silent remainder).
- [ ] Sara's §6 live trial completed on real data (DB backed up first) —
      **this box, not the suite, is sign-off.**
