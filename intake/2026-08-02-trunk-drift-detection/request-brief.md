# Request Brief: Trunk-drift detection

## Raw ask (verbatim)

This is a distilled request captured 2026-08-02 from a design conversation
with Sara (not a raw ticket/email). Her own framing, quoted from
`request-source.md`:

> Sara wants the Claude Code Agent Monitor (this repo's own product) to be
> able to **notice when real work has happened directly on a repo's
> trunk/default branch** (`main`/`master`, whatever it's named) — as opposed
> to work that went through a worktree/feature-branch flow the dashboard
> already tracks via declared session focus (`ccam focus set/push/pop`,
> `focus_inferences`, `detour_dispositions`).

> Sara explicitly split this into two steps and asked to scope **only step 1**
> right now: ... **Detection (this request's scope).** A passive,
> live-computed signal — same posture as `repo-topology.js`'s existing git
> derivations (recomputed per request, not cached) — that answers "is there a
> body of unattributed work on this repo's trunk branch, and what is it
> (which commits / what diff)?" No session required to produce it. Output:
> the commit range and enough content (diff/commit messages) to describe what
> happened. No classification judgment happens in this step.

Her phrase for the intended surfacing treatment: **"a badge indicating
unknown work"** — reuse the existing pending/undispositioned-detour badge,
not invent a new one.

## Restated ask

Build a live, uncached git-derived detector (following the
`server/lib/repo-topology.js` on-demand-recompute posture) that answers "is
there unattributed work sitting directly on this repo's default branch, and
what commits/diff make it up?" — with no classification, disposition, or
plan-matching logic. The detector's output is meant to slot into the
existing `detour_dispositions` pending-state lifecycle as a new `source`
value (something like `"trunk_drift"`), so it eventually gets picked up by
the **already-built and confirmed-reusable** `reconciliation.js` /
`buildDispositionPrompt` LLM disposition pass — but wiring that pickup path
is explicitly named as "minimal plumbing," and the deeper disposition
machinery itself is out of scope for this request.

## Requester / source

Sara, via a design conversation on 2026-08-02 (not a ticket/email — the
source file itself is a distilled write-up of that conversation, captured
for intake). No direct quotes from a chat log are available beyond what's
already reproduced in `request-source.md`; that document is being treated as
the requester's own words for triage purposes.

## Surface / area touched

- **New code (the ask):** a new detector module, analogous in posture to
  `server/lib/repo-topology.js` (per-request git derivation, not cached in
  SQLite), that inspects commit history on the default branch — something
  neither `repo-topology.js` nor any existing module currently does (today's
  git derivation is worktree/branch/dirty-state only, no commit-history
  walk).
- **Existing subsystem this must eventually feed (confirmed reusable,
  built 2026-08-01):** `detour_dispositions` table (`source` /
  `source_ref` / `source_seen_at` columns, unique index
  `idx_detour_dispositions_src` on `(cwd, source, source_ref)` — confirmed
  present in `server/db.js`), `server/lib/reconciliation.js`
  (`buildDispositionPrompt`, confirmed present and keys its prompt text off
  each detour's `label` field), `server/lib/detours.js`,
  `server/lib/plan-writeback.js`, `decision_queue`.
- **Not touched by this request:** the layer-7 portfolio rollup UI
  (deliberately deferred per the `portfolio-reconciliation-vision` memory);
  the classification/disposition vocabulary itself
  (`fold_in`/`new_item`/`deliberate`/`discard`).

## Known-variant relevance (PROJECT-CONTEXT.md recurring defect classes)

Checked `PROJECT-CONTEXT.md`'s catalog (six entries, §9.1–9.6). Flagging
what's germane so downstream evaluators don't have to re-derive it:

- **§9.2 row-id-as-chronology-proxy — directly relevant.** The detector's
  core job is walking commit history to find a *range* of unattributed
  commits. Any query that also joins against `events`/`focus_inferences`/
  other workflow-ingest-bulk-inserted tables to figure out "was this commit
  range ever attributed to a session" must sort by `created_at` (id as
  tiebreak), not `id` alone, per this catalog's established convention and
  the `assertOrderedByCreatedAt` helper precedent. Commits themselves are
  ordered by git's own DAG/committer-date, which is a different axis — worth
  the tech-plan explicitly stating which ordering governs "range of unattributed
  work" (git commit order vs. dashboard `created_at`) so the two don't get
  silently conflated.
- **§9.1 DERIVED-DUAL-VIEW — worth a design-time pre-flag, not yet an
  occurrence.** The request explicitly says the new detector's output
  (commit range/diff) will need to produce a `label` for
  `buildDispositionPrompt`, parallel to how session/focus narrative produces
  `label` today. That's a second, structurally different way of deriving the
  same `detour_dispositions.label` field. If the technical plan hand-writes a
  second label-formatting routine instead of extending the single existing
  one (or extracting a shared formatter), that reproduces this pattern — the
  catalog's own lesson is this class of bug lands at the *second* consumer,
  which is exactly the situation here (session-derived label already exists;
  this request adds label-source #2).
- **§9.5 / §9.6 (schema/migration) — likely relevant, not yet confirmed.**
  If `source_ref` (today presumably a `focus_inferences.id`-shaped value) needs
  to accommodate a commit-range identifier for the new `trunk_drift` source,
  confirm whether that's already schema-compatible (e.g. `source_ref` is
  already a loosely-typed text/string column) or requires a shape change —
  if it requires a `CREATE TABLE`/`CHECK` change, both §9.5 and §9.6's
  atomic-rebuild requirements apply. This needs the technical-plan author to
  check the actual column type in `server/db.js`, not assumed here.
- §9.3 (VACUOUS-GUARD) and §9.4 (FIX-ROUND-REGRESSION) are general process
  requirements (any guard test must be proven red-then-green; any fix round
  gets adversarial review) — apply as always, not specific to this surface.

## Provisional request type

**new-feature** (PROVISIONAL — PM makes the final call). This is net-new
detection capability; nothing today inspects trunk commit history. It is not
a bug/regression (nothing existing is broken) and not a
text/content-change. It could arguably be framed as a
missed-requirement against the layers-4-6 build (the PM plan for
`intake/2026-08-01-build-project-manager/` didn't include a trunk-side
detour source), but Sara's framing throughout the conversation is
forward-looking ("go implement," "a real technical plan") rather than
"this should have already existed" — recommend PM confirm which framing
governs prioritization/history reconstruction.

## Attachments / evidence

No screenshots or raw ticket text — this is a distilled conversation
summary. Evidence cited within the source doc itself, all pointing at real
repo state:

- `intake/2026-07-31-focus-untracked-commits/` — a **retroactive** intake
  Sara ran after `team-status` caught seven commits shipped directly to
  trunk with no `team-intake` folder and no declared focus. Cited as the
  concrete failure mode this detector would catch automatically going
  forward. Confirmed not a duplicate of this request (that intake documents
  one past incident; this request builds detection tooling).
- `server/lib/repo-topology.js` — confirmed to exist, confirmed to compute
  live worktree/branch/dirty state per-request without caching to SQLite (the
  posture this request wants matched) — confirmed it does **not** currently
  do any commit-history walk or flag "this branch is the repo's actual
  default branch" as a distinct condition (verified: no
  `defaultBranch`/`isDefaultBranch`-shaped code present).
- `server/db.js` / `server/lib/reconciliation.js` — confirmed directly
  (grep) during this intake pass: `detour_dispositions` has `source`,
  `source_ref`, `source_seen_at` columns and a unique index
  `(cwd, source, source_ref)`; `buildDispositionPrompt` builds its LLM prompt
  text from each flagged detour's `.label` field. Both match what the source
  doc claims.

## Explicit acceptance signals

None stated in the "done when…" sense — this is a pre-build design
conversation, not a spec with acceptance criteria. The closest the source
doc comes:

- Output must be "the commit range and enough content (diff/commit messages)
  to describe what happened" (Sara's own phrase) — this reads as a minimum
  bar for the detector's output shape, worth treating as a soft acceptance
  signal for the technical plan.
- "No classification judgment happens in this step" is stated as a hard
  scope boundary, not an acceptance signal, but functions similarly — a
  build that sneaks classification logic into the detector fails this
  request's own stated scope.

## Confirmed scope boundary (carry forward — do not re-litigate)

This is the single most important thing for downstream evaluators to
preserve. Quoting the source doc directly because it is easy to scope-creep
on a request this close to an existing subsystem:

> **Classification (out of scope for this request — already exists,
> confirmed during the conversation).** ... Sara confirmed this matching
> logic **already exists**: `server/lib/reconciliation.js`'s
> `buildDispositionPrompt` already sends the LLM the current `PLAN ITEMS`
> alongside each pending detour and asks for exactly one of `fold_in` /
> `new_item` / `deliberate` / `discard` ... The ask is to plug the new
> detection signal into that **existing** lifecycle ... not build a parallel
> one.

And explicitly, from "Explicit non-goals":

> Not asking to change the classification/disposition logic itself
> (`fold_in`/`new_item`/`deliberate`/`discard`, `plan-writeback.js`,
> `decision_queue`) — that machinery is confirmed reusable as-is. Scope is
> the new detector plus the minimal plumbing to feed it into that existing
> lifecycle.

> Not asking to build the layer-7 portfolio rollup UI (still deliberately
> deferred per `portfolio-reconciliation-vision` memory).

Downstream evaluators (technical planner, PM, QA) should scope this request
as: **(1) build the detector, (2) wire it into `detour_dispositions` as a new
`source` value with a `label`-producing path, and stop there.** Any proposal
to redesign `fold_in`/`new_item`/`deliberate`/`discard`, rework
`plan-writeback.js`, or build the layer-7 rollup UI is out of scope for this
intake and should be flagged back to Sara as a separate request, not folded
in silently.

## Open questions

### BLOCKING

None. The request is unusually well-specified for a design-conversation
distillation — it names the exact files, the exact schema columns, the exact
scope boundary, and the exact prior-art precedent to follow. Nothing here
blocks a technical planner from starting.

### Non-blocking (stated assumptions — technical planner should confirm or
override explicitly)

1. **What counts as the default branch, and how it's determined.** The
   source doc says "the repo's actual default branch" but doesn't specify
   the detection method (local git config, `origin/HEAD`, a hardcoded
   `main`/`master` fallback list, GitHub API). **Assumption:** the technical
   plan should follow whatever git-native mechanism is most robust locally
   (e.g. `git symbolic-ref refs/remotes/origin/HEAD`, falling back to
   `main`/`master` presence) — this repo is local-first per its own mission
   statement, so no GitHub API dependency should be introduced without
   explicit sign-off.
2. **What "unattributed" means precisely — the boundary condition.** The
   request says work is invisible when "no session declares focus," but
   doesn't specify how the detector should treat a commit that *does* carry
   session metadata (e.g. co-author trailer, commit message convention) vs.
   one that's genuinely anonymous. **Assumption:** for this detection-only
   step, the detector does not need to attempt attribution at all — it only
   needs to identify the commit range on trunk that has no corresponding
   `detour_dispositions`/`focus_inferences` row yet marking it as seen. Any
   smarter attribution heuristic is a candidate for the (out-of-scope)
   classification step, not detection.
3. **Trigger/frequency for the detector.** `repo-topology.js` is described
   as "computes ... per request" (i.e., driven by the Project Detail page
   view). It's unspecified whether trunk-drift detection should be (a)
   purely on-demand per page view like `repo-topology.js`, or (b) also
   invoked by `reconciliation.js`'s periodic pass so `trunk_drift` entries
   get created without a human opening the Project Detail page.
   **Assumption:** given the request explicitly says the *output* should feed
   `reconciliation.js`'s periodic qualification pass, the detector likely
   needs a periodic/cron-invocable entry point in addition to (or instead
   of) an on-demand one — this is a real design decision for the technical
   plan, not just a triage note, but does not block scoping since either
   answer keeps the request's boundaries the same.
4. **`source_ref` shape for a commit-range-keyed detour.** Noted above under
   known-variant relevance (§9.5/§9.6) — needs a schema check, not assumed
   here, before the technical plan finalizes the column's contents (e.g. a
   commit SHA, a `sha_start..sha_end` string, or a separate lookup table).
5. **Idempotency / re-detection on subsequent runs.** If the same trunk-drift
   commit range is detected on every request (per the "recomputed, not
   cached" posture), something must prevent duplicate `detour_dispositions`
   rows from being enqueued on every page view. **Assumption:** the existing
   unique index `(cwd, source, source_ref)` already handles this the same
   way it does for other sources, provided `source_ref` is a stable
   deterministic identifier for the commit range (e.g. the range's ending
   SHA) — worth the technical plan stating this explicitly rather than
   leaving it implicit.

## PM/tech-plan note

Given this request extends a subsystem the project's own memory
(`portfolio-reconciliation-vision`) already tracks as an open build
priority, and given the explicit tie to
`intake/2026-08-01-build-project-manager/`'s technical-plan.md/pm-plan.md,
the technical planner should read those two documents (not just this brief)
before designing — they establish the `detour_dispositions` shape, the
`reconciliation.js` pass structure, and the §9.1/§9.2/§9.5/§9.6 lessons this
brief only summarizes.
