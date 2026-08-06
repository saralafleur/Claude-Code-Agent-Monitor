# Architect — Value Pool Slice 3: Auto-group proposal engine

**Intake:** `2026-08-06-auto-group-proposal` · **Stage:** intake-architect (Wave 1)
**Grounded against:** `PROJECT-CONTEXT.md` §9 (repo topology, §9.1/§9.3/§9.5–§9.8),
live reads of `server/lib/value-ledger.js`, `server/lib/value-summary.js`,
`server/lib/value-coverage.js`, `server/lib/focus-summary.js`,
`server/routes/project-plans.js`, `server/db.js` (schema conventions),
`server/__tests__/single-writer-guard.test.js` — all read 2026-08-06, not
assumed from prose.

---

## 1. Affected subsystems & boundaries

| Layer | File (new unless noted) | Owns |
|---|---|---|
| Pool composer (existing, unmodified) | `server/lib/value-ledger.js` | `assembleValuePool` — sole source of pool membership (DEC-16). Slice 3 adds a **new registered consumer**, never a new query. |
| Per-unit synthesis (existing, unmodified) | `server/lib/value-summary.js` | `enrichPoolAltitudes` / cached `value_unit_summaries` rows — Slice 3's LLM refinement **reads** this cache, never writes it. |
| Coverage gate (existing, unmodified logic; one shared call extracted) | `server/lib/value-coverage.js` | `coverageSnapshot` / `complete` — Slice 3's gate check is a **third caller** of the 4-step probe composition (see §4, SF-4). |
| **Grouping engine (NEW — this slice's one new home)** | `server/lib/value-groups.js` | Mechanical pre-grouping, LLM refinement, hierarchical rollup, and the persisted-proposal read/write shape. This is the layer this slice actually adds. |
| Schema (NEW) | `server/db.js` | `value_group_runs`, `value_groups`, `value_group_members` — three new tables (see §4). |
| Route surface (NEW handlers on existing file) | `server/routes/project-plans.js` | `POST /groups/propose`, `GET /groups`, `POST /groups/:id/{approve,dismiss}` (naming indicative, PM/tech-lead to finalize). Also the SF-4 extraction site. |
| Client (NEW panel, or `PlanLedgerPanel` extension) | `client/src/components/...` | Renders `value_groups` rows verbatim — no client-side rollup/recompute. |

The boundary that matters most: **`value-groups.js` is the only place cross-unit
grouping judgment happens**, exactly one altitude above `value-summary.js` the
same way `value-summary.js` sits one altitude above `value-ledger.js`. Nothing
in the route layer or the client may compute a candidate cluster, a group
membership decision, or a group-level rollup number itself.

## 2. Current design

This project has an established, three-times-repeated architectural pattern
on this exact surface, and Slice 3 should be its fourth application, not a
new shape:

1. **`value-ledger.js`** — sole composer, never persists, recomputed on every
   call. Exposes a `CONSUMERS` array (DEC-16 tripwire) that every reader must
   register in, enforced partly by `single-writer-guard.test.js`'s
   `assertSingleHome`.
2. **`value-summary.js`** — sits one altitude above the composer, but
   **deliberately does not call `assembleValuePool` itself** (its own header,
   verbatim: "callers... pass the exact units their own pool fetch already
   resolved, so this module never re-derives or duplicates pool assembly").
   It owns the LLM spawn contract, the cache, and a `SUMMARY_STAGES` registry
   that **already reserves a `"grouping"` stage** (`value-summary.js:100-107`)
   with the model-tiering cascade (`summaryModel("grouping")`,
   `DASHBOARD_VALUE_SUMMARY_GROUPING_MODEL`) already wired and pinned to
   sonnet (DEC-10, closed — do not recalibrate).
3. **`value-coverage.js`** — a third layer, fed *solely* by the composer's
   `counts` output, with an explicit header rule: "NO pool-membership SQL and
   NO membership query of its own." Its own `coverageSnapshot` is the single
   computed-once object both the HTTP route and the WS broadcast carry
   verbatim, proven by a named parity test.
4. **`focus-summary.js`** — the precedent for hierarchical decomposition
   (below).

Each of these three files enforces its single-home status the same
mechanical way: an `assertSingleHome(modulePath, {consumerPath: {shared,
absent}})` call in `single-writer-guard.test.js`, whose **export axis** is
derived from the module's real `module.exports` and whose **consumer axis**
is hand-typed and must be updated in the same commit a new consumer lands
(§9.7's own recorded lesson, occurrence 7 — the same build that added the
consumer forgot to add itself to the map).

**Does the current code already follow this pattern for Slice 3's surface?**
No — because Slice 3's surface doesn't exist yet. The pattern is the
*established convention to extend*, not something already partially built.
The one live gap this slice inherits is **SF-4**: the 4-step probe-coverage
composition (assemble → `enrichPoolAltitudes({probe:true})` → sweep-state
read → `coverageSnapshot`) is hand-written twice today, once in
`POST /coverage-request` and once in `GET /coverage`
(`server/routes/project-plans.js:299-367`, confirmed by direct read), and the
two copies have already diverged once on `requestedAt`. The standing note on
this WATCH says extract when "Slice 3's consumer lands" — and Slice 3's own
100%-coverage gate check needs the exact same composition a third time.

## 3. Options

### 3a. Two-stage seam: what the mechanical pass emits, what the LLM consumes

**Option A (recommended): mechanical pass over-generates auditable candidate
clusters; LLM stage disambiguates.** The deterministic pass never tries to
produce final groups. It emits a flat array of **candidate clusters**:

```
{
  clusterId: string,          // stable, deterministic (hash of signal+members)
  signal: "slug" | "time" | "surface",
  memberUnitKeys: string[],   // >= 2, always traceable to the raw signal
  anchor?: string             // e.g. the intake_initiative unitKey a slug-match clustered around
}
```

A unit may appear in more than one candidate cluster (a commit can both
reference a slug *and* land in a time-adjacency window with something else).
That overlap is **by design** — resolving it is exactly the judgment the LLM
stage exists to do, and it is exactly what keeps the mechanical half cheap,
deterministic, and 100% independently testable without ever invoking the
LLM (a unit test can assert "these three raw signals produce these three
candidate clusters" with zero mocking of `runClaudePromptJson`).

The LLM refinement prompt consumes candidate clusters as **structured,
numbered fact lines** — the same idiom `value-summary.js`'s own
`buildPrompt` already uses (`buildPrompt(units)` → numbered
`[value_source] label, stage=X` lines), never a hand-composed prose
paragraph:

```
CLUSTER 1 (signal=slug, anchor=intake_initiative:2026-08-04-value-pool-grouping):
  - [trunk_commit] Add mechanical pre-grouping pass — <cached PROJECT/STAKEHOLDER text>
  - [trunk_commit] Extract buildProbeCoverage — <cached PROJECT/STAKEHOLDER text>
CLUSTER 2 (signal=time, window=2026-08-05):
  - ...
```

Each member line's text is the unit's **already-cached** `project_level`/
`stakeholder_level` text (read via the existing `getValueUnitSummary`
statement or an accessor `value-summary.js` exports for this purpose) — never
re-synthesized, never a second LLM call over the same unit. This is the
concrete mechanism that keeps this slice's "reuse the already-generated
(cheap) PROJECT/STAKEHOLDER texts" requirement literal rather than aspirational.

*Rejected alternative:* pure LLM clustering over the raw pool with no
mechanical pass. Contradicts the request's explicit "mechanical pre-grouping
first (free, deterministic, auditable)" framing, and removes the one part of
this engine that's cheaply unit-testable without touching the LLM contract.

### 3b. Pre-grouping heuristic shapes (open question 1)

- **Slug signal** — deterministic string match: a `trunk_commit`/`merge_commit`
  unit clusters with an `intake_initiative` unit when the commit's label
  (subject line) contains that initiative's slug substring, or references
  `effort/<slug>` — the same slug format `intake-scan.js` already parses.
  Zero threshold tuning; either the substring is present or it isn't.
- **Time-adjacency signal** — cluster units whose timestamps
  (`seen_at`/`created_at` on the unit) fall in the same **local calendar
  day**, reusing `focus-summary.js`'s own established day-bucketing
  convention (`localDayChunks`/`nextLocalMidnight`) rather than inventing a
  new duration constant. This is a deliberate reuse-not-reinvent call: this
  project already has exactly one canonical definition of "what counts as a
  time bucket" for synthesis purposes, and a second, independently-tuned
  window would be an unforced duplication. Per §9.8's bound-citing
  corollary, the exact width is not something to guess at design time — the
  technical plan should measure the real live pool's commit-time clustering
  distribution (the 102-unit pool cited in the request-brief's live
  verification) before hard-coding a threshold, and the declaring comment
  must cite that measured number the same way `MAX_UNITS_PER_PROMPT`'s
  comment now must.
- **Shared-surface signal** — conservative v1 scope recommendation: match on
  overlapping top-level path segments extracted from commit subjects/labels
  (a cheap string heuristic already in reach of data `detectTrunkDrift`
  returns), **not** full commit-diff file-path analysis. Full diff-based
  surface detection is more accurate but requires the engineer to confirm
  `trunk-drift.js`'s commit object shape actually carries file paths cheaply;
  if it doesn't, this is real added cost per unit at ~200-unit pool scale.
  **This is a scope boundary I am deliberately narrowing, not deciding
  silently** — flagged in my summary as needing a `decisions.md` row (see
  Return summary).
- Whether thresholds are tunable: no — fixed constants with a cited
  measured-distribution comment, same posture as `MAX_UNITS_PER_PROMPT`.
  Tunability is not needed for a proposal-only feature that a human reviews
  before anything is claimed; premature configurability here just adds a
  second surface for §9.7-style hand-typed-scope drift.

### 3c. Hierarchical rollup shape (open question 2)

`focus-summary.js`'s real precedent, read directly
(`server/lib/focus-summary.js:420-522`):

- **Direct path** (≤`DIRECT_WINDOW_MAX_DAYS`): one LLM shot over raw facts.
- **Hierarchical path** (wider): decompose into **per-day** chunks, each
  synthesized via the *same* direct-path function (so a day built as a
  rollup leaf is byte-identical to one requested standalone), cached
  independently and *permanently* once a day is closed; then **one** rollup
  shot over the per-day bullet lists, with a bullet budget that scales with
  span. The two properties that make this honest, both explicitly named in
  §9.8's catalog note: **decompose** — no session cap ever drops a whole day
  (a day is the atomic unit of decomposition) — and **disclose** — a day
  whose own synthesis fails degrades to its raw fact lines instead of
  vanishing from the rollup input.

**Slice 3's analogous shape**, and the one genuine structural difference to
name up front: a focus-summary "day" has a stable identity (closed calendar
days don't change), so per-day caching is free and permanent. A grouping
**batch** has no such natural stable identity — the pool is live and
recomputed on every call (`assembleValuePool`'s own contract). So the
analogy holds for the *decomposition* shape but not for the *caching*
mechanism verbatim; that has to be re-derived, not copied blind (see the
cost-control risk in §4).

- **Atomic unit of decomposition:** a **candidate cluster** (from the
  mechanical pass), never a raw unit. A cluster's `memberUnitKeys` must never
  be split across two LLM batch calls — the group-level analogue of "no cap
  ever drops a whole day."
- **Batching:** when the pool's candidate clusters (with their already-cached
  member text) exceed one prompt's budget, partition them into batches by
  cluster (never mid-cluster), each batch producing its own set of **named
  leaf groups** via one sonnet call (this file's own `"grouping"` stage —
  DEC-10, no new model work).
- **Rollup:** **one** additional sonnet call over the batches' leaf-group
  summaries (name + one-sentence summary + member *count*, not full member
  text — the group-level analogue of a day's bullet list) to merge
  overlapping/duplicate groups across batch boundaries into the final
  proposal set. Member unitKeys themselves are carried forward by reference
  (not re-sent through the rollup prompt) — the rollup only needs to decide
  *which leaf groups are the same real thing*, not re-derive membership.
- **Decompose, stated plainly:** no candidate cluster is ever silently
  dropped from consideration because the pool exceeded one prompt's worth —
  it is guaranteed a batch.
- **Disclose, stated plainly — this is the exact half the run-plan's own
  citation says the last two Value Pool builds dropped:** if one batch's
  refinement call fails/times out, that batch's candidate clusters must still
  surface as proposals — as **unrefined mechanical clusters** (deterministic
  signal + member list, no LLM-authored name/summary/rationale), in a
  **distinguishable status** (e.g. `refinement_failed` on the batch's groups,
  never absent from the `value_groups` table and never silently merged into
  "zero groups produced"). This is the concrete, load-bearing answer to the
  run-plan's instruction to state explicitly how Slice 3 avoids
  `value-summary.js`'s and `altitude-invalidation`'s shared failure (copying
  the cap, dropping both the decomposition and the disclosure).

### 3d. `value_groups` persistence shape

**Recommended: a join table, not a JSON array**, plus a run-status table
(detailed in §5). A JSON `unitKeys` blob is cheaper to write but structurally
cannot support (a) querying which members are still live in the pool at
review time, (b) Slice 4's eventual batch-claim (which needs to iterate real
rows in one transaction), or (c) a per-member resolved/stale state — all
three are concrete near-term needs, not speculative ones. `value_claims`
already establishes this project's own precedent for "membership is rows,
judgment fields live on the row," and DEC-16/§9.1's "reuse, never re-derive"
principle argues for extending that shape rather than inventing a
JSON-blob alternative for one table.

## 4. Architectural risks

- **§9.8 OVERLOADED-ABSENCE is the standing trap named by the parent request
  itself**, and it bites at two altitudes here, not one:
  - *Run-level:* `SELECT * FROM value_groups WHERE project_id=?` returning
    `[]` is ambiguous by construction unless a companion run-status row
    disambiguates *why*. See §5's `value_group_runs` design — this is the
    direct structural analogue of `value_summary_sweep_state`'s existing
    per-project row, which already solves exactly this problem for the
    coverage surface.
  - *Batch-level (inside one run):* a batch whose refinement failed must not
    collapse into the same "no group here" absence as a batch that
    genuinely found nothing worth grouping. Both are real, both must be
    representable, and they must be different values on the wire (§3c).
- **Proposal/live-pool drift (a risk not named in the brief's own
  enumeration — flagging it explicitly as new).** `value_groups` rows are
  **persisted**, but pool membership is **not** — `assembleValuePool` is
  recomputed live on every call and members can be claimed (removing them
  from the pool) or reattributed between the moment a group is proposed and
  the moment a human reviews/approves it. A review UI that renders a stale
  member list, or a batch-claim (Slice 4) that claims a member already
  claimed elsewhere, is a correctness bug, not a cosmetic one. The technical
  plan must decide: re-validate each member against current pool/claim state
  at *display* time (cheap: check `value_claims` for the member's `unitKey`)
  and render a per-member `still_available` / `already_claimed` /
  `no_longer_in_pool` distinguishable state — never silently drop or
  silently include a stale member. **This is a scope boundary — see Return
  summary for the required `decisions.md` disposition if Slice 3 v1 defers
  it.**
- **Cost/scale at ~200 units, the request's own explicit concern.** Because
  candidate-cluster computation is free (mechanical) but batch caching has no
  free stable-identity analogue to focus-summary's calendar day (§3c), a
  repeated grouping run over an *unchanged* pool will re-spawn the LLM every
  time unless the technical plan adds its own digest-gated cache — mirroring
  `computeInputDigest`, keyed on (project_id + sorted candidate-cluster
  membership + each member's cached-text hash). Without this, "click
  auto-group again to see if anything changed" becomes an unbounded-cost
  action at Sara's own stated 200-unit scale. Recommend building this in
  Slice 3 v1, not deferring it — it's the direct cost analogue of
  `focus-summary.js`'s "repeat views... serve straight from cache with ZERO
  LLM calls," and skipping it here would be the same shape of "copied the
  cap, not the thing that made the cap honest" this catalog already
  penalized twice.
- **Trust boundary — proposals never actions, and this must remain
  mechanically true, not just documented.** `value-groups.js` must have **no
  write path into `value_claims`.** Approving/dismissing a group changes
  `value_groups.status` only; any actual claim action is Slice 4's territory
  through the existing claims API. The single-writer guard for the new
  table's writer(s) should assert this by construction (scan finds zero
  `value_claims`-writing statements anywhere in `value-groups.js`).
- **§9.6 schema posture.** `value_group_runs`/`value_groups`/
  `value_group_members` are brand-new tables — plain `CREATE TABLE IF NOT
  EXISTS`, zero `ALTER`/rebuild needed at introduction, per the "prefer
  inapplicability over compliance" principle this project has already
  applied twice successfully on this exact request family (Slice 2's
  `value_summary_sweep_state`, the parent request's own `value_groups`
  framing). If a later fix-round needs a status-enum `CHECK`, it routes
  through `rebuildTableAtomically`, never a hand-rolled rebuild.
- **OPEN-4 (`MAX_PROJECTS_PER_TICK`) — confirmed no touch needed.** Slice 3's
  coverage need is per-project and on-demand, already served by Slice 2's
  coverage-request drain. No reconciliation work required; this is a
  non-finding, stated for completeness per the run-plan's explicit ask.

## 5. Recommended approach

Build `server/lib/value-groups.js` as the sole home for pre-grouping,
refinement, and rollup — following `value-summary.js`'s own architectural
posture exactly (does **not** call `assembleValuePool` itself; a route
handler resolves the pool and the units' cached altitude text and passes
them in). Concretely:

**Schema (three new tables, all plain `CREATE TABLE IF NOT EXISTS`):**
- `value_group_runs` — one row per grouping attempt: `id`, `project_id`,
  `status` (`in_progress`/`completed`/`failed` — no `not_started` row is
  ever written; its absence *is* that state, which is fine because it's a
  distinguishable, intentional absence, unlike a group's own absence inside
  a completed run), `started_at`, `completed_at`, `group_count`,
  `error_reason`. Direct structural analogue of
  `value_summary_sweep_state`.
- `value_groups` — one row per proposed group: `id`, `run_id` (FK), `name`,
  `summary_sentence`, `rationale`, `refinement_status`
  (`llm_refined`/`refinement_failed` — the batch-disclosure state from §3c),
  `review_status` (`proposed`/`approved`/`dismissed`), timestamps.
- `value_group_members` — `group_id` (FK), `unit_key`. Join table, per §3d.

**Consumer registration (do in the same commit the new consumer lands, per
§9.7's own recorded lesson):**
- Add the new route handler (or `value-groups.js` itself, whichever actually
  imports `assembleValuePool`) to `value-ledger.js`'s `CONSUMERS` array.
- Add the new consumer's disposition to `assertSingleHome`'s hand-typed
  consumer maps for **both** `value-ledger.js` and `value-summary.js` in
  `single-writer-guard.test.js` — this is exactly the axis §9.7 occurrence 7
  found silently stale in the immediately-preceding Slice 2 build, inside
  the same commit that added the consumer.
- Write a new single-writer guard for `value_groups`'/`value_group_runs`'
  writer(s), mirroring the `upsertValueUnitSummary` guard's shape (exact
  lexical call-site count, scoped to `value-groups.js`), red-proven by
  mutation per §9.3's standing rule — no exceptions, this file family's
  density (9/9/4) is the reason `intake-qa` is forced on for this build.

**SF-4:** extract `buildProbeCoverage(dbModule, projectId, {requestedAt,
draining})` (exact home: `value-coverage.js` or a small sibling) wrapping the
4-step composition, and make **all three** callers —
`POST /coverage-request`, `GET /coverage`, and Slice 3's own 100%-coverage
gate check — call through it. This is mechanically the engineer's scope, but
architecturally load-bearing: Slice 3 must not become the third hand-copy
the WATCH was written to prevent. If the technical plan chooses to defer
extraction instead, that must be a dated `decisions.md` row citing the
already-diverged `requestedAt` history, not silent.

**Client:** one new read path (`GET /groups?project_id=`) returning
`value_groups` rows joined with their members' review-time resolution state
computed server-side; the client renders those fields verbatim. No
client-side member-count or coverage-of-members recompute.

---

## Ruling on the three named open questions

1. **Pre-grouping heuristics.** Deterministic over-generating candidate
   clusters (slug substring match, local-calendar-day time-adjacency reusing
   `focus-summary.js`'s own bucketing convention, and a conservative
   label/path-substring shared-surface proxy for v1), fed to the LLM as
   numbered structured fact lines (mirroring `value-summary.js`'s
   `buildPrompt` idiom) built from each member's already-cached altitude
   text — never raw prose, never re-synthesized member text. See §3a/§3b.

2. **Hierarchical rollup.** Batch by candidate cluster (never split a
   cluster across batches — the atomic decomposition unit), one sonnet call
   per batch producing named leaf groups, one final sonnet rollup call over
   leaf-group summaries (not full member text) to merge across batch
   boundaries. Both halves of the "decompose, don't drop" / "disclose what
   was dropped" rule are load-bearing requirements, not optional polish: a
   failed batch's clusters must still surface as `refinement_failed`
   mechanical proposals, never silently absent. See §3c.

3. **WATCH-6.** Confirmed, not overturned: the grouping engine only **reads**
   `value_unit_summaries` (via the existing cached-row accessor) and writes
   only to the three new tables. The existing `value_unit_summaries`
   single-writer guard does not widen. A **new** guard is required for the
   new tables' writer(s), and the **consumer-axis** registration on the
   *existing* `value-ledger.js`/`value-summary.js` guards must be updated in
   the same commit per §9.7's already-recorded lesson on this exact family.

## Ruling on §9.1 DERIVED-DUAL-VIEW / DEC-16 (single home)

Grouping computation lives in exactly one new module, `server/lib/value-groups.js`,
one altitude above `value-summary.js`, following its established
"doesn't call the composer itself" posture rather than inventing a new one.
`value_groups` is read by the client through exactly one route
(`GET /groups`) returning the server-computed shape verbatim — any
per-member resolution state or group-level rollup is computed once inside
`value-groups.js` (or the route handler calling into it), never
re-derived client-side. This is the same discipline `value-coverage.js`
already applies to `coverageSnapshot`, extended to a fourth layer.

---

## Return summary (scope boundaries needing tracking, not just prose)

- **Shared-surface heuristic scope** (§3b): recommending a conservative
  label/path-substring proxy for v1 rather than full commit-diff file-path
  analysis, pending the engineer confirming what `trunk-drift.js`'s commit
  objects actually carry. If the fuller version is deferred, it needs a
  dated `decisions.md` row, not just this paragraph.
- **Proposal/live-pool member-staleness re-validation** (§4): a genuinely new
  risk (members can be claimed or reattributed between proposal and review).
  If Slice 3 v1 does not build per-member re-validation at display/approval
  time, that deferral needs a dated `decisions.md` WATCH row citing this
  risk explicitly — silent deferral here is a direct §9.8 shape (a claimed
  member silently included in, or silently vanished from, a group's
  displayed membership).
- **Grouping-result cost-control caching** (§4): recommending it ship in v1
  given Sara's explicit ~200-unit cost/UX framing; if the technical plan
  defers it, that too needs a dated row, since re-running the whole engine
  on every "auto-group" click at 200-unit scale is a real, foreseeable cost
  problem, not a hypothetical one.
