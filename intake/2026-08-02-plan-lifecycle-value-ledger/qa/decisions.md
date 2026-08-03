# QA Decision Log — 2026-08-02-plan-lifecycle-value-ledger

Run mode: **auto-pilot** (`/team-qa auto`). PREFERENCE gates decided
automatically as `DECIDED-AUTO`; QUALITY and required-input gates still stop.

---

## QDEC-1 — Scope resolution

- **Status:** DECIDED-AUTO (2026-08-02)
- **Question:** What is the QA scope?
- **Where we're coming from:** The skill argument carried only the mode token
  (`auto`). The invoking conversation's immediately preceding turn completed
  team-intake on `intake/2026-08-02-plan-lifecycle-value-ledger/` and its
  DEC-19 greenlit "team-qa on this technical plan"; Sara then invoked
  `/team-qa`.
- **Decision:** team-intake hand-off mode — scope is that intake folder's
  `technical-plan.md` change set (a PRE-BUILD plan; QA plans the tests that
  will prove it, per this pipeline's established pre-build QA convention).
  Output under `<intake-dir>/qa/`.

---

## QDEC-2 — Coverage verdict

- **Status:** DECIDED-AUTO (2026-08-02, `qa-strategist`)
- **Verdict:** **GAPPED — one escape hatch away from BLIND.** Full reasoning in
  `qa-assessment.md`. Not BLIND because both catalog entries this change lands
  on (§9.1, §9.7) have their cures specified as named, dated deliverables with
  filenames and written red-proof procedures.

## QDEC-3 — The six must-add obligations (M1–M6) are recommendations, not edits

- **Status:** DECIDED-AUTO (2026-08-02) — preference-level under auto-pilot
- **Decision:** M1–M6 in `qa-assessment.md` are recorded as **recommendations
  bound to slice gates**, not applied to the test-design documents. Rationale:
  the four supporting documents are their authors' deliverables; a strategist
  rewriting them would hide which obligations were designed in versus added at
  review — which is exactly the provenance §9.4 says must stay visible.
- **Sara may override any of them**; the build lead should treat the slice-gate
  table as the checklist.
- **Superseded in effect by QDEC-6:** M1–M6 are now folded into `test-plan.md`
  as first-class numbered obligations (O-7, O-8, O-16, O-18, O-19 and the
  QDEC-5 forcing function). The provenance is preserved in that document's
  "Layer reconciliation" section.

## QDEC-4 — Durable cures recommended for adoption *now* rather than deferred

- **Status:** DECIDED-AUTO (2026-08-02), recommendation recorded
- **Recommendation:** take **M4** (whole-namespace, plural-aware locale key
  parity in `i18n.test.ts`) in slice 1 and **M2** (OpenAPI operationId-uniqueness
  + route↔spec completeness test, plus an `openapi-extra/project-plans.js`
  fragment with non-colliding ids and an `openapi.yaml` regen) in slice 3. Both
  fix classes that are **already broken on master** and are not strictly this
  feature's fault; both are roughly an hour and retire a recurring tax. Deferring
  them means this feature ships a colliding `operationId` and a locale registry
  that only covers keys someone remembered to type.
- **Also recommended:** `ccam ledger health --json`, which converts T6 from
  regex-scraped labels into an exact deep-equal.

## QDEC-5 — DEC-9's bounded fallback needs a forcing function

- **Status:** DECIDED-AUTO (2026-08-02), recommendation recorded
- **Recommendation:** the fallback may be taken **only** with a dated
  `decisions.md` row naming the pre-existing violator set and the remainder —
  never as the silent default. Additionally, now that
  `server/__tests__/helpers/single-home.js` exists (built and red-proven by the
  trunk-drift build, verified still **absent from `master`**), the closure
  single-writer guard (T5) and T4's import rogue-writer scan must be
  **`assertSingleHome` call sites**, not a second hand-rolled scope-derivation
  helper.
- **Promoted to a DoD line** in `test-plan.md` (§Definition of Done, "Registry /
  source-of-truth in sync").

---

# Rows added by the `qa-lead` synthesis pass (2026-08-02)

> These arose from reconciling the four evaluator documents plus the strategist's
> verdict into `test-plan.md`. Auto-pilot conventions: PREFERENCE-level gates
> resolved as **DECIDED-AUTO** with the recommendation recorded; anything only
> Sara can rule on is **PENDING (Sara)** with the auto-pilot fallback stated so
> the build is never blocked on an unanswered row.

## QDEC-6 — `test-plan.md` is the build checklist; obligations are numbered O-1…O-24

- **Status:** DECIDED-AUTO (2026-08-02, `qa-lead`)
- **Decision:** the test plan supersedes and concretizes `technical-plan.md` §6
  "Testing & verification". Where the two disagree, the test plan wins, and every
  divergence is enumerated in its "Layer reconciliation" section so build review
  can still see which obligations were designed in versus added at reconciliation
  (§9.4 provenance rule). The strategist's M1–M6 are **not** appendix notes: they
  are numbered obligations inside the slice sequence (M1→O-17/A6.8, M2→O-19,
  M3→O-16, M4→O-8, M5→O-18 + QDEC-5, M6→QDEC-14…QDEC-18).
- **Scale:** ~120 new/changed cases — 63 server module unit, 28 HTTP contract,
  11 CLI+parity, 7 structural/registry meta, 2 i18n, 9 client.

## QDEC-7 — Placement of the cross-seam `unitKey` agreement case (risk trap T2 / M1)

- **Status:** DECIDED-AUTO (2026-08-02)
- **Question:** the strategist proposed the case in **both** `value-ledger.test.js`
  (T5) and `value-pool.test.js` (T3); the risk analysis named it and no evaluator
  adopted it.
- **Decision:** **one behavioral home — `server/__tests__/value-pool.test.js`
  (case A6.8)**: write the claim through a case-variant (darwin-guarded) or
  worktree cwd, assemble the pool through the canonical one, assert the unit is
  still excluded **and** the duplicate claim is still blocked by the UNIQUE index.
  Red-proven by removing canonicalization from the **claim-write seam only**.
  Rationale: the failure is an *assembly* failure, and T3 is the only spec that
  owns real git fixtures + `project_paths` seeding + the full `assembleValuePool`
  path. A duplicate in T5 would mean two fixtures for one invariant, and
  historically one of the two rots.
- **Plus a fast diagnostic in `cwd-identity.test.js`** (A4, last case): a
  `[symlink-alias, case-variant, worktree-path] × canonical` table asserting
  `canonicalizeCwd(variant) === canonicalizeCwd(canonical)` — so an A6.8 failure
  is diagnosable to a specific seam in seconds. T5 keeps its single-casing
  cardinality/UNIQUE cases as the complement, unchanged.

## QDEC-8 — The `operationId` collision is fixed by namespacing the NEW ids

- **Status:** DECIDED-AUTO (2026-08-02)
- **Question:** `server/openapi-extra/plans.js:236` already owns
  `operationId: "getProjectPlans"` for the **legacy** `GET /api/plans/project/{projectId}`
  rollup. The new `/api/project-plans` namespace collides on it.
- **Decision:** the legacy id is **shipped contract and is not renamed** (generated
  clients depend on it). The new fragment uses namespaced ids:
  `listPortfolioPlans`, `getPortfolioPlan`, `createPortfolioPlan`,
  `closePortfolioPlan`, `importPortfolioPlan`, `createPortfolioPlanItem`,
  `updatePortfolioPlanItem`, `deletePortfolioPlanItem`, `createValueClaim`,
  `deleteValueClaim`, `getValuePool`, `getLedgerHealth`, `getLedgerHistory`.
  This is also the R1 (dual-plan-surface never-blend) rule applied at the docs
  layer, where every generated client and every contract reader lands.

## QDEC-9 — Shape of the OpenAPI contract spec (M2 / O-19)

- **Status:** DECIDED-AUTO (2026-08-02)
- **Decision:** one new `server/__tests__/openapi-contract.test.js`, 4 cases,
  deriving everything from `createOpenApiSpec()` in `server/openapi.js` (the
  declared single source of truth) — no HTTP boot needed:
  1. `operationId` uniqueness across the merged spec, failure message naming the
     colliding pair;
  2. every `app.use("/api/…")` mount in `server/index.js` (32 today) has ≥1 path
     entry, modulo a **dated `GRANDFATHERED_MOUNTS`** array (populate at authoring
     time from whatever is genuinely absent *after* the regeneration; known
     candidates `topology`, `intake-status`, `color-thresholds`, `terminal-focus`),
     length-asserted with a "do not widen" message — same convention as
     `GRANDFATHERED_QUERIES`;
  3. every route in `routes/project-plans.js` has a path entry with an operationId;
  4. **round-trip:** re-run the generator's transform in memory
     (`yaml.dump(createOpenApiSpec(), {lineWidth:-1, noRefs:true, sortKeys:false})`
     + the two header lines, exactly as `scripts/generate-openapi-yaml.js` does)
     and byte-compare against the committed `openapi.yaml`; failure message
     "run `npm run openapi:yaml` and commit the result".
- **Build steps this forces:** author `server/openapi-extra/project-plans.js`,
  register it in `server/openapi-extra.js` (fragments are hand-enumerated at
  `:13-26` / `:52` — that enumeration *is* the CONTRACT-SPEC-DRIFT mechanism),
  and run `npm run openapi:yaml` in the same change-set.
- **Note:** case 4 is **already red on `master`** (`openapi.yaml` last regenerated
  2026-07-30). That is a genuine recorded red state, fixed by regeneration —
  never by weakening the assertion.

## QDEC-10 — DEC-4 dedupe: pragma-seeded assembly **and** mapper **and** tripwire (M3)

- **Status:** DECIDED-AUTO (2026-08-02)
- **Question:** `server/db.js:701` is still
  `source TEXT NOT NULL CHECK(source IN ('inferred','declared'))`, so the
  `source='trunk_drift'` row DEC-4's named test needs cannot be inserted until
  trunk-drift Phase 1b widens the CHECK — and Phase 1b is gated on an unscheduled
  live trial. The unit architect offered two non-equivalent workarounds.
- **Decision: do all three, in `value-pool.test.js`.**
  **(a) Primary** — pragma-seeded full-assembly test (A6.5) under
  `db.pragma("ignore_check_constraints = 1")`, restored to `0` immediately, with a
  written justification block next to the pragma stating that the fixture is
  *future-real rather than never-real* and that §9.3's B4 shape is accepted on
  that basis. Without that paragraph the next reader deletes the test.
  **(b) Diagnostic** — export the row→unit mapper from `value-ledger.js` and test
  the mapping directly (A6.6). It proves the mapper, not the assembly, which is
  why it is not the primary: R7's failure is an assembly failure.
  **(c) Tripwire** — assert `detour_dispositions`' CHECK text read from
  `sqlite_master` **still excludes** `'trunk_drift'` (A6.7), with the failure
  message *"Phase 1b has landed: drop the pragma, re-seed through the real writer,
  and re-verify that `source_ref` carries a full 40-char sha."*
- **Rationale:** without (c) the pragma silently outlives its reason, and the one
  thing it cannot prove — that Phase 1b's writer uses the `source_ref` shape the
  mapper expects — is exactly where R7 lands. `risk.md` trap T1 predicts this test
  is the first thing dropped; a named DEC obligation plus a schema block is how an
  obligation becomes a comment.

## QDEC-11 — Slice-1 scope grew by two specs

- **Status:** DECIDED-AUTO (2026-08-02)
- **Decision:** slice 1's gate now also includes
  `server/__tests__/cwd-identity.test.js` (10 cases — the module is a single-home
  guardrail and T3/T4 failures must stay diagnosable) and the whole-namespace
  locale parity work in `client/src/i18n/__tests__/i18n.test.ts` (O-8).
- **The i18n move is the load-bearing part:** `unit-tests.md` §9 parked locale
  parity inside `PlanLedgerPanel.test.tsx`, which is DEC-12-gated — if Sara
  answers "noise" at slice 4 it never ships. It is not UI work. It also must carry
  the `_one|_two|_few|_many|_zero` exemption for single-plural-form locales, or it
  lands red on ~8 legitimate pairs on its first run and gets weakened instead of
  fixed. `sessions:remoteSourceBadgeTitle` (en-only; ko/vi/zh live under
  `settings.json`) is fixed in the same commit.

## QDEC-12 — Layer reconciliation: what moved, what stayed doubled

- **Status:** DECIDED-AUTO (2026-08-02)
- **Kept as complements, deliberately not deduped:**
  - T5's **static** closure single-writer guard vs e2e **C4**'s behavioral
    closed-door route sweep. C4 proves no HTTP verb transitions an open plan to
    closed; T5 proves no second *code path* writes the closure, including ones
    with no route. Either alone leaves a real hole.
  - T5's stmt-level `SQLITE_CONSTRAINT` case vs B1-**D2**'s route-level 409
    mapping (S2 is an error-mapping risk, not a constraint risk).
  - T2's `PRAGMA table_info` no-`closed_at` case vs B1-**F3**'s
    no-closed-flag-in-JSON case (different artifacts).
- **Moved:** `ccam ledger health` **value equality** out of `ccam-cli.test.js`
  case 5 and wholly into T6 — one home per §9.1; the CLI spec keeps exit codes,
  usage, offline posture and the no-`NaN` check.
- **Ratified as designed:** pool permutations (ratchet, backfill, dedupe,
  chronology, identity warnings) stay in the unit layer; e2e Group E keeps shape
  pins only. No live-WS harness is added — WS assertions stay lib-level with an
  injected `broadcast` collector plus an **allowlist** (not contains-check) so a
  third type cannot ride along.
- **Dropped from the intake QA's original scope:** T1's
  `UPGRADE_CASES`/`REBUILD_CASES`/interruption cases (no rebuild exists), and the
  "rewrite the deletes-removed-numbers case" instruction — `plan-ingest.test.js`
  stays green **and byte-unmodified**.

## QDEC-13 — All four durable cures are adopted NOW (Sara may override)

- **Status:** DECIDED-AUTO (2026-08-02) — **flagged for Sara's override** per the
  strategist's open decision "accept the durable cures now, or just the point tests?"
- **Decision:** take all four in this change-set: derived `filesToScan` scope
  (O-18), consumption of `assertSingleHome` rather than a second hand-rolled
  scanner (O-7/O-12), whole-namespace locale parity (O-8, slice 1), and the
  OpenAPI contract test + regen (O-19, slice 3).
- **Consequence of deferring, recorded so the trade is explicit:** §9.7 recurs for
  the **7th** time on the build that could have been its second clean call site,
  with every §9.2 obligation inside `value-ledger.js` unenforced while the suite is
  green; a second scope-derivation helper repeats §9.1's helper-copy lesson within
  the same week the cure was built; the locale registry keeps covering only keys
  someone remembered to type (and dies entirely if Sara answers "noise"); and the
  feature ships a colliding `operationId` onto the artifact `server/README.md:523`
  calls the source of truth for request/response contracts.

## QDEC-14 — `ccam ledger health --json`

- **Status:** **PENDING (Sara)** — product-surface addition, recommendation recorded
- **Recommendation:** yes. It converts T6 from label-anchored regex scraping into
  an exact `deepEqual`, and removes the "someone reworded a label and the parity
  test silently stopped matching" failure — which would read as green on the one
  spec this whole plan is built around.
- **Auto-pilot fallback if declined (build is not blocked):** T6 uses
  label-anchored extraction (`/unclaimed[^0-9-]*(\d+)/i` → `Number` equality,
  `lastClosureAt` as an exact ISO string) **with an in-file comment declaring the
  printed labels part of the parity contract**, so a later reword is a knowing
  contract change rather than silent drift.

## QDEC-15 — S1: unknown-project 404 vs audit semantics

- **Status:** **PENDING (Sara)** — contract decision with a data-loss-shaped
  consequence; recommendation recorded and already encoded as a test case
- **Recommendation (from the e2e pass, endorsed by the strategist and this plan):**
  `POST /` and `POST /import` → **404** on an unknown `project_id`; `list`, `pool`,
  `health`, `history` → **404 only when neither a project row nor any
  `project_plans` row exists** for the id.
- **Why it matters:** `project_plans.project_id` has no FK *by design* so closed
  generations outlive their project. A blanket "unknown project → 404" on the GETs
  makes `history`/`health` unreachable the day a project row is deleted, which
  destroys the audit story (AC-6) this feature exists for.
- **Encoded as `project-plans-api.test.js` Group S:** delete the project row via
  raw SQL in-test, re-`GET /history` and `/health` → still 200, while create/import
  → 404. **If Sara rules the other way, invert that case and record it here.**

## QDEC-16 — S3 and S5 pinned by auto-pilot

- **Status:** DECIDED-AUTO (2026-08-02)
- **S3 — `POST /api/project-plans` returns 201**, matching the sibling create
  precedent in `projects.test.js`. Pinned before three consumers (route, CLI, UI)
  can fork on 200-vs-201.
- **S5 — `ccam ledger` refuses offline for both writes and reads.** Pool/health
  math is server-side; this matches the `cost` command's existing stance. Pinned so
  the posture is designed rather than accidental.
- **S2 and S4 need no decision** — both are already assertions: the duplicate-claim
  409-not-500 mapping (B1 D2) and the `:id(\d+)` literal-segment tripwire (B1 A4,
  which is also the Express-5-upgrade canary, since param-regex syntax is removed
  there).

## QDEC-17 — WATCH: pool-assembly request-path cost

- **Status:** WATCH (opened 2026-08-02) — no test planned this round, by decision
- **Risk (`risk.md` §1c/§6.1):** `GET /pool` does git subprocesses
  (`detectTrunkDrift`, two `rev-parse` per cwd), `realpathSync` per cwd and an
  intake directory walk **per request**, uncached and unbudgeted. DEC-6 bounds
  lookback depth, not request cost. This degrades Project Detail *and* the slice-4
  gate itself — Sara judging "signal or noise" through a 10-second CLI call.
- **Escalation trigger:** if `ccam ledger pool` or `GET /pool` on real Coaching
  Assistant data exceeds **~2 s** at the slice-4 checkpoint, this becomes a design
  decision (cache, debounce, or a persisted baseline) before slice 5 — not a
  post-ship optimization.

## QDEC-18 — Tracked obligation: re-confirm `detectTrunkDrift` at the DEC-2 merge

- **Status:** DECIDED-AUTO (2026-08-02) — tracked as obligation **O-3**, closes
  against DEC-2's trigger-to-close
- **Why it needs a row:** every `value-pool.test.js` case is designed against a
  signature verified only in an **uncommitted worktree**
  (`detectTrunkDrift(repoPath, {seenShas, lookbackDays, maxCommits, timeout, now})`).
  The change brief carries this as a proceeding-on-assumption note; nothing tracked
  the *obligation to re-verify*.
- **Specifically re-verify:** whether `seenShas` is an **exclusion set** or a
  since-marker (if the latter, the A6.3 ratchet case passes for the wrong reason and
  must be redesigned); the `{commits[].sha}` / `{skipped: reason}` return shapes;
  that `TRUNK_DRIFT_SKIP_REASONS` is imported rather than retyped; and that
  `isGitRepo` is imported from `server/lib/repo-topology.js:39/:219` — the technical
  plan misstates its home as `git-refs.js`. Record the confirmation in build notes.

## QDEC-19 — Re-baseline and snapshot-regen hygiene are gates, not ceremony

- **Status:** DECIDED-AUTO (2026-08-02)
- **Decision:** the observed 241/241 baseline (144 nine-spec floor + 27
  pool-adjacent + 34 client + 36 trunk-drift-worktree) was taken against a **dirty
  tree of 60 modified paths** and must be **re-taken on a clean tree after the DEC-2
  merge, before slice 1** (obligation O-4). Rerun commands are in `test-plan.md`
  §"Regression floor".
- **Snapshot regen (F3/O-24) runs only on a tree containing this effort's UI diff
  and nothing else.** `ProjectDetail.tsx` (+1,287 lines), `api.ts`, `types.ts`,
  `projectDetail.json` ×4 and `screens.snapshot.test.tsx.snap` are dirty on master
  **and** modified in the trunk-drift worktree; a blind `vitest run -u` would
  launder a sibling effort's unreviewed UI diff into reviewed baselines, which
  `CLAUDE.md` forbids outright.
- **`git worktree list` + a running-session check before every git operation.**
  Project memory records real work loss from exactly this configuration, and
  `PROJECT-CONTEXT.md` was edited by another live session *during* this QA pass.

### QDEC-20 — Proceed to team-build

- **Status:** DECIDED-AUTO (2026-08-02, Step 5 PREFERENCE gate under auto-pilot)
- **Decision:** `team-build` on this item (technical-plan.md + qa/test-plan.md)
  is greenlit as the next pipeline stage. HOWEVER the build itself remains
  hard-gated behind: DEC-2 (trunk-drift Phase 1a must merge to master first —
  it is still uncommitted in its worktree), and slice-0's O-1..O-4
  obligations. The PENDING (Sara) rows (intake DEC-10..DEC-13; qa QDEC-14,
  QDEC-15) do not block test authoring but DEC-12/DEC-13 gate slice 4.
