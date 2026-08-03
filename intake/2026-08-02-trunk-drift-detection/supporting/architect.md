# Architect assessment: trunk-drift detection

Grounded by direct reads of `server/lib/repo-topology.js`, `server/lib/detours.js`,
`server/lib/reconciliation.js`, `server/lib/update-check.js`, `server/lib/git-env.js`,
`server/db.js` (schema + prepared statements around `detour_dispositions`), and
`PROJECT-CONTEXT.md`'s defect catalog (§9.1, §9.2, §9.5, §9.6) plus
`intake/2026-08-01-build-project-manager/decisions.md` (WATCH-4).

## 1. Affected subsystems & boundaries

- **New code, live-derivation layer** — a new module (e.g.
  `server/lib/trunk-drift.js`) that owns "what commits sit on this repo's
  default branch that no one has accounted for." This is a peer of
  `server/lib/repo-topology.js` and `server/lib/update-check.js`, not part of
  either: `repo-topology.js` owns worktree/dirty-state (no commit-history
  walk today — confirmed, no `defaultBranch`/`isDefaultBranch`-shaped code
  anywhere in it); `update-check.js` owns *remote* comparison
  (fetch-then-diff against a canonical upstream/origin ref) for a completely
  different purpose (is the dashboard's own checkout behind). Trunk-drift
  detection is neither — it is a same-repo, local-history question ("what
  landed on trunk that no session declared") — so it earns its own module
  rather than being bolted onto either.
- **Ownership boundary that must hold:** `server/lib/detours.js`'s own header
  says it "owns every read/write of `detour_dispositions` except the
  write-audit columns." The new detector module must not write to
  `detour_dispositions` itself — it should return a plain derived value
  (commit range + content), and a small adapter function inside
  `detours.js` (parallel to the existing `backfillDeclaredDetours`) does the
  upsert. This preserves the single-writer boundary the request brief itself
  calls "minimal plumbing," and matches this repo's existing shape: one
  function per source that turns raw source data into
  `stmts.upsertDetourDisposition.run(...)` calls.
- **`reconciliation.js`'s `buildDispositionPrompt`** — touched only in the
  sense of receiving more/different `label` values in its `flagged` array.
  No signature or prompt-shape change is architecturally required (see §4/§6).
- **`server/db.js` schema** — touched more deeply than the request brief
  assumes (see §4, "the real migration risk").

## 2. Current design

- **`repo-topology.js`'s posture** (the explicit precedent this request wants
  matched): every call recomputes live from `git worktree list --porcelain`
  and `git status --porcelain`, with hard per-request bounds
  (`MAX_DIRTY_CHECKS_PER_REQUEST`, `MAX_SIBLING_SCAN_ENTRIES`,
  `MAX_NESTED_SCAN_DIRS_PER_REPO`, `NESTED_SCAN_MAX_DEPTH`) so a pathological
  repo/filesystem can't turn one page load into unbounded subprocess/FS work.
  Nothing it computes is cached in SQLite; the module's own header states
  this explicitly and cites `update-check.js` as the sibling precedent. It
  never determines "is this branch the default branch" today — confirmed by
  reading the whole file; `branch`/`head`/`detached` are the only
  worktree-identity fields it produces.
- **Default-branch determination already exists in this repo, just not in
  `repo-topology.js`.** `update-check.js`'s `resolveCompareRefForRemote`
  tries `<remote>/master`, then `<remote>/main`, then falls back to
  `git symbolic-ref refs/remotes/<remote>/HEAD` — this is exactly the
  git-native mechanism the request brief's own "non-blocking assumption #1"
  asks for, and it's already battle-tested (used in production for the
  update-check flow, has its own test fixtures in
  `server/__tests__/update-check.test.js`). It requires picking a remote
  first (`pickCanonicalRemote`, preferring `upstream` over `origin`) and,
  when not skipping fetch, doing a `git fetch <remote> --prune` first so
  `origin/HEAD`/`origin/master` are current.
- **`detours.js`'s current shape:** `DISPOSITIONS` is the single source of
  truth for the four-value enum (explicitly there to prevent the JS
  check/SQL CHECK drifting — its own header cites §9.1). Two source-specific
  write paths exist today: `recordInferredDetour` (label supplied
  pre-computed by `focus-inference.js`'s classifier) and
  `backfillDeclaredDetours` (label composed inline from `events.data`'s
  `title`/`description`, sorted `created_at ASC, id ASC` per §9.2). Both
  funnel into the same `stmts.upsertDetourDisposition` prepared statement,
  whose `ON CONFLICT(cwd, source, source_ref)` clause refreshes only
  observational fields (`label`, `item_id`, `source_seen_at`) and leaves
  disposition/decision fields untouched — this is the project's existing,
  working idempotency mechanism (see §5).
- **`reconciliation.js`'s `buildDispositionPrompt`:** reads `f.label || ""`
  off each flagged row with no source-awareness at all — it does not care
  how a row arrived, only that it has a `label` string. The whole assembled
  prompt (PLAN ITEMS + all flagged detours) is hard-truncated to 8,000 chars
  (`.slice(0, 8_000)`). This truncation is source-blind and was tuned for
  small session-narrative-derived labels.
- **Schema (`server/db.js` ~line 696-736):**
  `source TEXT NOT NULL CHECK(source IN ('inferred','declared'))` — a
  **CHECK-constrained enum**, not a loosely-typed column. `source_ref TEXT
  NOT NULL` — no CHECK, no shape constraint. The unique index is
  `idx_detour_dispositions_src ON detour_dispositions(cwd, source,
  source_ref)`.

## 3. Determining the default branch reliably (per repo)

Do not hardcode `main`/`master`, and do not build a second implementation.
Three options:

- **Option A — reuse `update-check.js`'s `resolveCompareRefForRemote` /
  `pickCanonicalRemote` as-is (or export and share them).** Correct,
  proven, git-native. Downside: it's coupled to a *remote* ref
  (`<remote>/master` etc.) and a `git fetch`, which the trunk-drift detector
  arguably shouldn't require (it's asking "what happened locally", not "are
  we behind the remote," and a fetch is a network call this repo's
  local-first posture should avoid making mandatory on every page view).
- **Option B — a local-only variant: `git symbolic-ref refs/remotes/<remote>/HEAD`
  without fetching first, or, if no remote-tracking HEAD is set up,
  `git branch --show-current` on whichever worktree currently has trunk
  checked out.** No network call, matches `repo-topology.js`'s existing
  no-network posture (it never fetches). Risk: `refs/remotes/<remote>/HEAD`
  is only set locally after a `clone` or an explicit `remote set-head`; a
  long-lived local clone that never re-set it, or a repo cloned with
  `--single-branch`, may have a stale or absent value.
- **Option C — a small shared helper, `resolveDefaultBranch(repoPath, {
  allowFetch: false })`, extracted so both `update-check.js` and the new
  trunk-drift detector call the *same* resolution logic** (remote-HEAD
  symbolic-ref first, then `<remote>/main`/`<remote>/master` verify, then
  local `main`/`master` branch existence as a last-resort fallback), with
  `allowFetch` defaulting to false for the trunk-drift caller and true for
  the existing update-check caller. This is what "prefer the option that
  preserves a single source of truth" cashes out to here: two independent
  "what's the default branch" implementations is exactly the kind of
  duplicated-logic shape PROJECT-CONTEXT.md's catalog keeps re-flagging in
  other subsystems (§9.1), even though "default branch" isn't itself in the
  catalog yet — no need to wait for a third occurrence to avoid a second one
  when the first one already exists and is well-tested.

**Recommendation: Option C.** Extract the ref-resolution core of
`update-check.js` into a shared helper (or export the existing functions and
wrap them with a fetch-optional flag) rather than writing a second
`main`/`master`-guessing function inside the new module. This is a small,
mechanical refactor of already-correct, already-tested code — not new risk.

## 4. Options for the trunk-drift detection point

**Two distinct questions get conflated in the brief and should be separated
in the tech plan.** "Which git ref means trunk" (answered in §3) is not the
same question as "which commits on trunk are new since we last looked" —
the latter is what actually needs an option analysis, and *diffing against
`origin/<default>` answers neither of these correctly by itself.*

- **Option 1 — diff local trunk against `origin/<default>`.** Rejected as
  the primary mechanism: this measures **push lag**, not **attribution**.
  The concrete failure mode is the exact scenario this request exists to
  catch — "a human committing by hand" on trunk almost always also pushes
  that commit, at which point local trunk and `origin/<default>` converge
  and the diff goes to zero, silently hiding the very commits that need
  flagging. It is real value as a secondary filter (e.g., "don't surface a
  detour for a commit that hasn't even reached origin yet, might still be
  amended/rebased away") but must not be the detection axis itself.
- **Option 2 — a persisted last-reconciled marker (a high-water-mark SHA or
  timestamp) stored in a new column/table, advanced each time the detector
  runs.** Cheap incremental `git log <marker>..<trunk-head>` per call.
  Downside: this reintroduces exactly the cached/stateful posture the
  request explicitly asks the detector to *avoid* ("same posture as
  `repo-topology.js` — recomputed per request, not cached") — a marker is a
  second, new piece of persisted git-derived state, is a new schema surface
  (more §9.5/§9.6 exposure), and can drift from reality (a marker advanced
  past a commit before that commit was ever turned into a
  `detour_dispositions` row, e.g. on a crash between "walk history" and
  "write rows," silently drops that commit forever).
- **Option 3 (recommended) — no new marker at all: use the already-persisted
  `detour_dispositions` rows themselves as the ledger.** Each call to the
  detector walks trunk's commit log (bounded — see below), and for each
  commit SHA checks whether a `detour_dispositions` row with
  `source='trunk_drift' AND source_ref=<sha>` already exists (a single
  indexed lookup per commit against `idx_detour_dispositions_src`, or one
  batched `IN (...)` query). Commits with no such row are "unattributed."
  This keeps the *detection* step itself fully stateless/live-derived (no
  new cache, no new marker column) while getting idempotency "for free" from
  infrastructure that already has to exist anyway (the pending-detour rows
  are the whole point of wiring this into the existing lifecycle). It also
  self-heals: if a marker-based approach ever silently skipped a commit,
  it's silently skipped forever; this approach re-examines full history
  every time (bounded by a lookback window, mirroring
  `DASHBOARD_RECONCILE_LOOKBACK_DAYS`'s existing precedent in
  `reconciliation.js`) so a bug in one run cannot cause a permanent miss.

  Bound the walk with a lookback window (new env knob, e.g.
  `DASHBOARD_TRUNK_DRIFT_LOOKBACK_DAYS`, following the exact naming/config
  convention `reconciliation.js` already established) rather than walking
  full repo history on every request — this is the same class of per-request
  cost bound `repo-topology.js` already applies
  (`MAX_DIRTY_CHECKS_PER_REQUEST` etc.), just for commit-log length instead
  of subprocess count.

**§9.2 ordering note, made explicit per the eval brief's own flag:** the
commit-range "what order did work happen in" question is governed by git's
own DAG/committer-date (`git log`'s natural order on the default branch),
which is a *different axis* than `detour_dispositions.created_at`. The
"already seen this commit" check above is a *set-membership* test
(SHA in/not in the existing rows), not a chronological sort, so §9.2 doesn't
directly bind it — but if the tech plan adds any query that also joins
`focus_inferences`/`events` to attempt smarter attribution (explicitly
out of scope per the brief's assumption #2, but worth flagging so it isn't
silently added later), that join **must** sort by `created_at` (id
tiebreak), never `id` alone, per the established convention.

## 5. Risk: §9.1 DERIVED-DUAL-VIEW and §9.2, evaluated against actual code

**§9.2 — addressed above; low residual risk if Option 3 (§4) is taken, since
it avoids a new chronology-sensitive query pattern.** If a marker-based
approach (Option 2) is chosen instead, whatever table stores the marker and
whatever query reads "commits since the marker" must not silently assume
`detour_dispositions.id` ordering approximates commit order — they are
unrelated axes, and conflating them was explicitly named as a risk worth
stating outright in the tech plan.

**§9.1 — evaluated directly against the request brief's framing, and I
disagree with it in one respect.** The brief frames "a third way of
producing `detour_dispositions.label`" as a likely recurrence of
DERIVED-DUAL-VIEW. Having read the code: `label` is **already** produced by
two independent, hand-written composers today —
`recordInferredDetour` (label supplied by `focus-inference.js`'s classifier,
narrative text) and `backfillDeclaredDetours` (label composed inline from
`events.data.title`/`.description`). Neither is a duplicate of the other —
they describe genuinely different kinds of observations, and there is no
single "correct" value they're both trying to converge on (unlike, say,
`wall_ms`, the canonical §9.1 shape, where two consumers *should* show the
identical number). Adding a third, differently-shaped composer for
commit-derived content is not, by itself, a recurrence of "one true value
computed twice and drifting" — `buildDispositionPrompt` only ever reads
`f.label || ""` as an opaque string; it has no expectations about how that
string was built, so there's nothing for two implementations to *disagree*
about.

That said, the catalog's underlying, more general lesson still applies and
should be treated as a real requirement, not waved off:

- **Discoverability, not correctness, is the actual risk here.** The
  existing `backfillDeclaredDetours` composer is hand-inlined inside
  `detours.js` rather than extracted to a named function — so it is already
  one undiscoverable one-off before this request adds a second. The 9.1
  QA-pass note's own diagnosis ("test scope is per-module... gives a
  cross-consumer test no home, so it is nobody's file") generalizes past
  tests to *code organization*: a third hand-rolled label composer, written
  inside a brand-new `trunk-drift.js` module instead of alongside the other
  two, is exactly how a fourth, fifth, and sixth one accumulate later
  without anyone noticing there were ever three before.
- **A trust-boundary concern the brief doesn't name at all:** a trunk-drift
  label is the first `detour_dispositions.label` value built from content
  the repo doesn't control the shape of — arbitrary commit messages
  (attacker/contributor-authored free text) and diff content — flowing
  directly into a string that gets concatenated, unescaped, into an LLM
  prompt (`buildDispositionPrompt`'s `detourList` join) and separately
  rendered wherever the UI shows the badge's underlying detour. The existing
  two sources are much lower-risk inputs (a classifier's own narrative;
  a `push`/`bug`/`feature` verb's title typed by whoever ran `ccam focus`).
  Commit messages/diffs are comparatively uncontrolled text and should be
  size-capped and structurally isolated before insertion (see the 8,000-char
  truncation risk below), independent of the label-formatter-location
  question.
- **The 8,000-char truncation risk is real and specific.**
  `buildDispositionPrompt`'s final `.slice(0, 8_000)` is source-blind and
  applied to the *whole* prompt (PLAN ITEMS + every flagged detour's label).
  A trunk-drift label built from several commits' full messages (or worse,
  diff excerpts) is far larger than the narrative/title-based labels this
  budget was sized for. One oversized `trunk_drift` label in a batch can
  silently truncate — and thereby drop from the LLM's view — every *other*
  flagged detour and the PLAN ITEMS list in the same tick, producing wrong
  verdicts for unrelated detours with no error, no log line, nothing that
  fails a test that only exercises one detour at a time.

**Durable fix, matching the eval brief's ask for a shared interface rather
than parallel one-offs:** extract each source's label composer into a named,
exported function that lives in `detours.js` (the module that already
declares itself the owner of everything about this table) —
`formatDeclaredLabel(data)`, `formatInferredLabel(result)` (even if it's a
thin pass-through today), and a new `formatTrunkDriftLabel(commits)` for
this request — each with an enforced max length (a shared constant, e.g.
`MAX_DETOUR_LABEL_CHARS`, applied uniformly at the point every composer
returns, not just at the trunk-drift one, so the fix generalizes instead of
special-casing the new source). This doesn't force the three sources to
compute the *same* thing — it gives all label-producing logic one home and
one shared size contract, which is the generalizable, project-agnostic
"single source of truth over duplicated logic" principle the eval brief
asks me to default to, applied to the part of this shape that's actually a
real risk (discoverability + a shared size/trust contract) rather than the
part that reads like 9.1 on the surface but isn't (three sources need not
produce interchangeable values).

## 6. Risk: the real schema migration this request has already been priced for (WATCH-4)

The request brief's own risk section focuses on `source_ref`'s shape and
treats it as unconfirmed. Having read the schema directly: **`source_ref TEXT
NOT NULL` carries no CHECK and no shape constraint — a commit SHA fits it
today with no migration at all.** The brief pointed at the wrong column.

**The column that actually blocks this request without a migration is
`source` itself:** `source TEXT NOT NULL CHECK(source IN ('inferred',
'declared'))`. Adding `'trunk_drift'` requires widening this CHECK, and
SQLite cannot `ALTER TABLE ... ADD` or otherwise loosen a `CHECK` in place —
this is precisely §9.5's "cannot be expressed as an additive ALTER" carve-out
into §9.6 (NON-ATOMIC REBUILD) territory: a full rename/create-copy-drop
table rebuild, which **must** be wrapped in a single `BEGIN…COMMIT`
transaction (the `agents` table, `server/db.js` ~line 1563-1599, is the
**only** one of six existing table rebuilds in this file that does this
correctly today; the other five — including two touches on `plan_items`,
and `token_usage` twice — are not atomic, per §9.6's own catalog entry) and
must ship with both an `UPGRADE_CASES` entry in
`server/__tests__/db-migration.test.js` (legacy-shape seed, migrate, assert
column/constraint, second-run no-op) **and** an interruption test proving a
crash mid-rebuild doesn't silently orphan the old table (§9.6's acceptance
criterion — "second boot is a no-op on a *clean* completion" is explicitly
called out as not sufficient evidence).

**This is not a new discovery — it's an already-accepted, already-priced
cost coming due.** `intake/2026-08-01-build-project-manager/decisions.md`'s
**WATCH-4** ("CHECK-constrained enums are rebuild-to-widen") names
`detour_dispositions.source` by exact column name and states outright:
"adding a fifth disposition later requires the full rename-copy-drop dance
... Accepted because the four dispositions are fixed by a confirmed design
decision." `source` currently has exactly two values (`inferred`,
`declared`) — this request is the first real occasion to add a third, and
WATCH-4 already flagged that this exact move has this exact cost. The
technical plan should treat this migration as first-class scope, not
"minimal plumbing" — it's the single largest concrete piece of work in this
otherwise small request, and skipping straight to "just widen the CHECK"
without the atomic-rebuild treatment reproduces the shape §9.6's own catalog
entry was written about, on the exact table it names as a prior near-miss.

**A design choice this creates, worth flagging as its own decision rather
than deciding it silently in the tech plan:** §9.6's catalog entry recommends
a durable, generic `rebuildTableAtomically({ table, createSql, copySelect,
indexes })` helper, explicitly **not yet built** ("durable cure recommended,
2026-08-02, not yet built"). This request is a natural forcing function to
build it now (this rebuild becomes the second real call site, informing a
better-designed helper) — but building a generic helper is more scope than
a one-off atomic rebuild copied from `agents`' existing pattern. Either
choice is legitimate; what must not happen is the tech plan picking one
implicitly and only documenting it in prose. **This needs an explicit
PENDING/WATCH row in this request's own `decisions.md`** (or an update to
WATCH-4 itself marking it "now due, mitigation chosen: X") stating which
path was taken and why, not just a paragraph in `technical-plan.md` that
nobody re-reads once the migration ships.

## 7. Idempotency / re-run safety

Confirmed directly from `server/db.js`: `idx_detour_dispositions_src` is a
**unique index on `(cwd, source, source_ref)`**, and
`upsertDetourDisposition`'s `ON CONFLICT(cwd, source, source_ref) DO UPDATE`
clause refreshes only `label`, `item_id`, `source_seen_at` — disposition and
all decision/write-audit fields are left untouched on conflict. This is the
project's existing, working idempotency mechanism, already proven for two
sources; it will work identically for `trunk_drift` **provided
`source_ref` is a stable, deterministic identifier that does not change
between two detection runs over the same commit.**

- **Recommend `source_ref` = the commit SHA, one row per commit** (not a
  `start..end` range string). A range string breaks idempotency the moment
  the range grows between two detector runs (a new commit lands on trunk
  before the prior range's row was disposition'd): the range's end changes,
  so the range string changes, so the unique index treats it as a *new* row
  rather than updating the pending one — silently leaving a stale,
  orphaned pending row alongside a new one describing an overlapping range.
  Per-commit SHA rows sidestep this entirely (a SHA is permanent and
  content-addressed) and mirror how `declared`/`inferred` sources already
  key one row per one underlying observation (an `events.id`, a
  `focus_inferences.id`) — no new shape convention introduced.
- **Reconcile this with Sara's stated output requirement** ("the commit
  range and enough content... to describe what happened") by keeping that
  framing at the *detector's own return-value* layer (a rich, ungated
  object describing a contiguous run of commits, for direct UI/API
  consumption — matching `repo-topology.js`'s own return-shape precedent of
  a structured object, not a database row) while the **adapter/plumbing
  layer** that turns detector output into `detour_dispositions` rows
  explodes that range into one `upsertDetourDisposition` call per commit
  SHA, exactly the way `backfillDeclaredDetours` already explodes a set of
  `events` rows into one upsert call per event. This is the direct parallel
  to point to in the tech plan rather than inventing new plumbing shape.

## 8. Options summary

| # | Approach | Preserves live-recompute posture | New schema surface | Idempotency risk |
|---|---|---|---|---|
| 1 | Diff local trunk vs `origin/<default>` as the detection axis | Yes | None | Wrong semantics — misses pushed commits entirely (rejected as primary) |
| 2 | Persisted last-reconciled marker (new column/table) | No — reintroduces caching | New (marker storage) + still needs the `source` CHECK rebuild | Marker can silently skip a commit on a crash between walk and write |
| 3 (recommended) | Live full-history walk each call, bounded by lookback window, filtered against existing `detour_dispositions(source='trunk_drift', source_ref=sha)` rows | Yes | Still needs the `source` CHECK rebuild (unavoidable regardless of option) | Self-healing — re-examines full window every call, no separate state to drift |

Every option requires the §6 schema rebuild — that cost is not avoidable by
choosing a different detection-point strategy; it's inherent in adding a
third `source` value at all.

## 9. Recommended approach

1. **Detector module** (`server/lib/trunk-drift.js`): pure live derivation,
   no writes, mirroring `repo-topology.js`'s posture exactly — bounded git
   subprocess calls, no SQLite reads/writes inside the detector itself.
   Default branch resolved via the shared helper from §3 Option C
   (local-only by default, no forced fetch). Detection point per §4 Option
   3: bounded lookback window, commit-by-commit, filtered against existing
   `detour_dispositions` rows passed in by the caller (keeps the detector
   itself DB-read-only and easily unit-testable against a fixture repo, the
   same way `repo-topology.test.js` already tests against real `git init`
   fixtures).
2. **Adapter** in `detours.js`: `backfillTrunkDriftDetours(dbModule, cwd,
   commits)`, directly parallel to `backfillDeclaredDetours` — one
   `upsertDetourDisposition` call per unattributed commit SHA, label built
   by a newly-extracted, shared-home, length-capped composer per §5.
3. **Schema**: budget the `source` CHECK-widening atomic rebuild as
   first-class scope per §6, decide (and record in `decisions.md`, not just
   prose) whether to build the generic `rebuildTableAtomically` helper now
   or hand-roll one more atomic rebuild in the `agents` table's exact shape.
4. **Wiring into `reconciliation.js`**: no prompt-shape or function-signature
   change needed to `buildDispositionPrompt` itself; only the label-size cap
   from §5 needs to land before trunk-drift rows can reach it safely.

This keeps the detector itself exactly as small and "minimal plumbing" as
Sara asked for; the actual weight of this request is the schema migration
and the label-composer consolidation, both of which are real, both of which
the request brief either mis-located (source_ref vs. source) or
under-weighted (framed as a design-time pre-flag rather than "this is the
biggest single piece of work here").

## Scope boundaries not addressed here (must be tracked, not left as prose)

- **The `source` CHECK-widening rebuild strategy choice (§6)** — generic
  `rebuildTableAtomically` helper vs. one-off atomic rebuild. Needs a
  PENDING/WATCH row in this intake's own `decisions.md`, or an explicit
  update to WATCH-4 in `intake/2026-08-01-build-project-manager/decisions.md`
  marking it "now due." Left as prose only, this is exactly the kind of
  disclosed-but-untracked exclusion that becomes an undiscovered one once
  the migration ships and nobody re-reads this file.
- **Cross-referencing trunk commits against `focus_inferences`/`events` for
  smarter attribution** — explicitly out of scope per the brief's own
  assumption #2, but if a future round adds it, the §9.2 created_at-ordering
  requirement binds that join and should be a fresh WATCH row at that time,
  not retrofitted from this document's mention of it.
- **Label max-length/trust-boundary contract (§5)** — if the tech plan
  chooses not to extract a shared `formatXLabel`/size-cap contract this
  round and instead hand-writes `trunk_drift`'s label composer inline (the
  same shape as today's `backfillDeclaredDetours`), that's a legitimate
  scope trim, but it needs to be named as a WATCH row given it's the first
  label source built from uncontrolled external content and the first to
  risk blowing the shared 8,000-char prompt budget — not something the next
  reader should have to rediscover by reading this file's §5 in full.
