# Request Brief

**Intake folder:** `intake/2026-08-04-value-summary-tick/`
**Date logged:** 2026-08-04

## Raw ask (verbatim)

This is an internal engineering request, not an external client ticket — the
material was supplied directly to intake rather than via a separate file.
Quoting the source material as given:

> "Sara has projects with ~100+ value-pool units. Current behavior: only the
> first 40 uncached units get synthesized per page view; full coverage
> requires ~3 separate page reloads with no progress indicator, and there's
> no way to tell 'still generating' apart from 'LLM unavailable this round.'
> This is a real UX/correctness gap at that scale, not yet an incident —
> caught in design discussion before it caused a support issue."

Sara's own framing of the acceptance bar, verbatim:

> "I wanna create this so it's scalable, so that it's observable, and that
> it is the right long-term fix"

## Restated ask

At project-pool sizes above ~40 units, PROJECT/STAKEHOLDER altitude
synthesis (`server/lib/value-summary.js`) can't finish in a single page
visit and gives users no way to distinguish "still generating" from
"unavailable" — Sara wants this replaced with a scalable, observable
long-term fix, and has sketched (not approved) a specific direction: move
generation to a background tick, make the interactive endpoint read-only,
push live updates over the WebSocket, and add cache observability mirroring
the existing Focus Summaries cache tooling.

## Requester / source

Sara (project owner), raised in design discussion on 2026-08-04, immediately
following the initial three-altitude Value Pool feature shipping the same
day. Not an end-user complaint or support ticket — a pre-emptive
design-quality catch.

## Surface / area touched

- `client/src/components/PlanLedgerPanel.tsx` — Project Detail page, Plan
  Ledger panel, Value Pool section (three-altitude rendering, `altitudes`
  state, the `api.projectPlans.altitudes` fetch effect).
- `server/lib/value-summary.js` — `enrichPoolAltitudes(dbModule, units)`,
  `MAX_UNITS_PER_PROMPT = 40` cap, `value_unit_summaries` cache table.
- `server/routes/project-plans.js` — `GET /api/project-plans/pool` (ground
  units, reuses `value-ledger.js`'s `assembleValuePool`) and
  `POST /api/project-plans/altitudes` (currently synchronous, LLM-spawning
  on the request path).
- Proposed net-new surfaces (not yet built): `server/lib/value-summary-tick.js`,
  a new `startBackgroundServices()` registration in `server/index.js`, a new
  WebSocket message type (e.g. `value_altitudes_updated`), a new audit-log
  table mirroring `focus_summary_access_log`, new Settings routes mirroring
  `GET /api/settings/cache/timeline` / `GET /api/settings/cache/day`, and a
  new Settings UI section mirroring Settings → Focus Summaries.

## Known-variant relevance (PROJECT-CONTEXT.md recurring defect classes)

Checked `PROJECT-CONTEXT.md` §9 catalog for surfaces this touches:

- **§9.1 DERIVED-DUAL-VIEW** (a value computed once, consumed by multiple
  independent render/write surfaces) is the most relevant pattern to flag
  for the *design* phase, not yet an occurrence here. The proposed shape
  intentionally keeps a single writer of `value_unit_summaries` (only the
  new tick would write once the interactive endpoint goes read-only), which
  is the compliant shape — but the transition state matters: while the
  interactive endpoint is *migrating* from "reads and writes" to "reads
  only," there is a real risk of a second write path surviving somewhere
  (e.g. a fallback branch, a manual admin trigger) that isn't caught by a
  structural single-writer guard. Flag for the build/QA phase: if a
  single-writer guard is built for this (mirroring
  `single-writer-guard.test.js`), scope it explicitly to `value_summary_tick`
  + nothing else, per §9.7's lesson about hand-scoped scans.
- **§9.1's DEC-16 tripwire** (pool assembly must have exactly one composer,
  `value-ledger.js`'s `assembleValuePool`) is explicitly preserved by the
  current module's own header comment and must remain preserved by the new
  tick, which is proposed to reuse `assembleValuePool` rather than
  re-deriving pool membership — worth stating as an explicit acceptance
  criterion in the eventual plan, not just an intent.
- No §9.5/§9.6 (schema-rebuild) relevance yet identified — a new
  `value_unit_summaries`-adjacent audit table would be a new `CREATE TABLE`,
  not an alter/rebuild of an existing one, so those patterns are
  inapplicable unless the design changes.
- §9.2 (chronology-by-id) is relevant if the new tick or its audit log ever
  queries by insertion order for "recent" batches — should sort by
  `created_at`, per the project's established convention, if/when built.

These are pre-flags for the design/build phase, not findings against this
intake — no code exists yet for this specific request.

## Provisional request type

**new-feature** (PROVISIONAL — PM makes the final call). This is not a bug
fix to shipped behavior in the sense of "something broke" — the 40-unit cap
and lack of progress indicator work exactly as built. It's a scale
limitation identified before it caused a support issue, and the requested
remedy (background tick + observability layer) is materially new
architecture, not a patch. Arguably also has a `missed-requirement` flavor
(the original Value Pool build didn't design for 100+-unit projects) — worth
the PM confirming which framing this should carry into scoping, since it
affects how the acceptance criteria get graded.

## Attachments / evidence

None supplied beyond the prose description above — no screenshots, repro
steps, or example project. The "~100+ value-pool units" and "~3 page
reloads" figures are Sara's own estimates, not measured against a specific
project; worth confirming a real project ID to validate against during
design/build if precision matters (see non-blocking assumption below).

## Explicit acceptance signals

Sara stated three criteria directly, verbatim: **"scalable," "observable,"
"the right long-term fix."** No numeric or behavioral "done when…" was
given beyond that framing — e.g. no stated target like "all N units visible
within X minutes of first project view" or "Settings must show backlog
count." The PM/design phase will need to operationalize these three words
into checkable acceptance criteria.

## Ambiguity

### BLOCKING

None. The recommended direction is explicitly unapproved and unscoped by
Sara's own framing ("NOT yet approved or scoped by Sara") — that is
expected at this stage, not a blocker to writing the brief. The three open
questions below are genuine design forks, but none of them prevents the
next phase (PM scoping / design) from proceeding; they are exactly what
that phase exists to resolve. Flagging them here per instructions so the
evaluation phase does not silently default any of them.

### Non-blocking (flag for PM/design gate — do not resolve here)

1. **Tick sweep scope is undefined.** "Periodic sweep across projects with
   pool activity" doesn't say which projects: every project with any pool
   units ever (unbounded growth as more projects exist), only projects with
   an open plan, or only projects someone has visited recently (requires
   tracking "recently viewed" somewhere, which doesn't exist today for this
   surface). This directly affects cost (LLM spawn frequency ×
   project count) and staleness (a project nobody's looked at in months
   still burning tick budget vs. going stale until next visit). Assumption
   if forced to proceed: none stated — this needs an explicit PM decision,
   not a default.

2. **Interactive endpoint going fully read-only — UX regression risk for a
   brand-new unit.** Today, a freshly-created unit (e.g. right after a
   commit lands) gets synthesized on the very next page visit, within the
   existing 40-cap. Under the proposed design, that same unit shows
   "Generating…" until the next tick fires — which could be minutes away
   depending on the new env-configurable cadence — even though the old
   behavior (same-visit synthesis) worked fine below the 40-unit cap. This
   is a real trade: solving the >40-unit case by removing all synthesis
   from the request path also removes the fast path for the common
   <40-unit case. Worth the design considering a hybrid (e.g. request-path
   synthesis for the first ≤40, tick just for the overflow) as an
   alternative to pure read-only, rather than assuming full request-path
   removal is required to hit "scalable."

3. **Settings UI parity with Focus Summaries — in scope for this request or
   a follow-up?** The recommended direction bundles four sub-changes: (a)
   read-only endpoint, (b) background tick, (c) live WebSocket update, (d)
   full observability layer (new audit table + new Settings routes + new
   Settings UI section). (a)-(c) are the direct fix for the stated problem
   (coverage gap, no progress signal). (d) is what makes it "observable" per
   Sara's own third criterion, but is also the largest single piece of new
   surface area (new table, two new routes, one new UI section) and could
   ship as a fast-follow without blocking the coverage/UX fix. PM should
   decide whether "observable" must ship in the same build or can be
   sequenced.

Two smaller items worth carrying into design, not blocking:
- No cadence value is proposed for the new env var (mirrors
  `DASHBOARD_FOCUS_INFER_MS`'s *shape*, not necessarily its default of
  600000ms) — needs a number tied to whatever sweep-scope answer #1 above
  lands on.
- No batch-size-per-tick number (`N` in "batches up to N per tick") is
  proposed yet, distinct from the existing `MAX_UNITS_PER_PROMPT = 40`
  per-prompt cap — needs to be picked with real project sizes in mind.
