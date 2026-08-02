---
id: kb-product-coach-playbook-vocabulary
domain: product
subdomain: coach
title: Coach/Playbook vocabulary and proposed architecture — Coach, Playbook, Practice, Observation, Recommendation, Suggested action, Response, Coach engine
description: >-
  Load before building, discussing, or naming anything for the Coach feature
  (`/coach` page, `CoachPage.tsx`, i18n namespace `coach`) or its underlying
  rule/evaluation engine — and especially if you (or a request) are about to
  reach for the words "insight", "alert", "callout", "rule", or a bare
  "action" to describe part of this system, all of which were proposed and
  explicitly rejected in favor of the terms below. Also load when designing
  any new "practice"/check for the Coach, when touching
  `server/lib/playbook/` (proposed path, not yet created), or when the ask
  resembles "flag when a session crosses N tokens" / "suggest the user
  compact or clear" / "surface a recommendation based on usage patterns".
  Gives the finalized vocabulary table, the two precedents it's grounded in
  (`reconciliation.js` rule-tick pattern, Usage page's Color Thresholds
  user-editable-config pattern), the proposed code/schema/API layout, and the
  worked `session-token-ceiling` example, so a future session implements
  against agreed terms instead of re-deriving or drifting from them.
tags: [coach, playbook, naming, vocabulary, architecture, rule-engine, usage-analytics]
status: active
created: 2026-08-01
updated: 2026-08-01
source: conversation session 2026-08-01 — Coach/Playbook vocabulary decision (placeholder /coach page already shipped; this is naming/architecture only, nothing built)
---

# Coach/Playbook vocabulary and proposed architecture

## What this is
A finalized, Sara-approved vocabulary and a proposed (not-yet-built)
architecture for the Coach feature: a rule-based system that watches Claude
Code usage patterns in this dashboard and surfaces observations/
recommendations to the user. Only a placeholder scaffold exists so far
(`/coach` route, `CoachPage.tsx` empty state + 3 preview tiles, sidebar nav
entry grouped with Projects/Calendar/Focus/Usage, i18n namespace `coach`).
No backend logic exists yet. This entry is the vocabulary contract a future
implementation session should build against.

## Why it matters / the problem it solves
Naming for this kind of feature is genuinely hard to get right first try —
this session iterated through several candidate terms (see below) before
landing on a final set, and rejected terms for concrete, articulated
reasons. Without this record, a future implementation session would very
plausibly reintroduce one of the already-rejected terms (especially
"Insight" or "Callout", both natural-sounding words for this domain),
producing vocabulary drift between docs, code, and UI copy, and burning time
re-relitigating a decision that's already settled.

## How (the durable knowledge)

### The precedent this design generalizes from
Two existing subsystems were read and used to ground the proposal — this is
not a from-scratch design:

- **`server/lib/reconciliation.js`** — deterministic, *named* rules (R1 pace
  breach, R2 detour volume, R3 staleness) evaluated on a periodic tick, each
  with its own env-var-configurable threshold (e.g.
  `DASHBOARD_PACE_GRACE_DAYS`); hits land in an escalation queue with a
  `reason` field. This is the source of the "named rule, evaluated on a
  tick" engine shape.
- **Usage page's "Color Thresholds" card** (`server/db.js` `color_thresholds`
  table, `server/routes/color-thresholds.js`) — a rule's *config* made
  user-editable: server-persisted singleton, shared live across every
  connected computer, broadcasts a `color_thresholds_updated` WebSocket
  message on change. This is the source of the "user-editable, DB-persisted,
  WS-broadcast config UX" pattern.

Coach is proposed as a generalization of both, made generic (JSON config
column per rule, instead of fixed columns) so new checks can be added
without schema changes.

### Vocabulary iteration (context, not to be reused)
First pass, superseded in order: **Rule** -> **Insight** -> (Sara:
"Playbook and within it playbook practices") -> **Callout** (assistant's
proposal for the fired instance) -> Sara rejected "Callout" — sounds
confrontational/punitive, doesn't fit positive reinforcement, and is
ambiguous between the visual card and the underlying event — and gave the
final vocabulary below. **Do not reintroduce Rule, Insight, Callout, Alert,
or a bare "Action" as terms for this system.**

### FINAL AGREED VOCABULARY (use this exact terminology)

| Term | Meaning |
|---|---|
| **Coach** | The user-facing product/persona — the page, `/coach` route. Already shipped (placeholder scaffold only). |
| **Playbook** | The complete catalog/knowledge framework of coaching checks. Proposed to live in code as `server/lib/playbook/`. |
| **Practice** | One defined coaching principle/pattern/check within the Playbook — id, name, category, `defaultSeverity`, `scope` (session/project/global), detector logic. Example: `session-token-ceiling`. |
| **Practice config** | User-adjustable settings for a practice — enabled on/off, thresholds/params. Server-persisted, shared live across every connected computer, editable from the Coach page — same architecture as Usage's Color Thresholds card. |
| **Observation** | A specific *detected instance/occurrence* of a practice firing, for a scope, at a point in time. Has severity, status (open/dismissed/etc.), `detectedAt`. This is the noun that populates the Coach feed. Explicitly **not** "Callout" (confrontational/punitive framing; ambiguous between UI card and underlying event) and **not** "Insight" or "Alert" (earlier candidates, both superseded). |
| **Recommendation** | The guidance attached to an observation — summary, rationale, suggested actions. |
| **Suggested action** (UI-facing) / `recommendation.actions` (internal field name) | An optional concrete next step attached to a recommendation (e.g. copy session summary to clipboard, deep-link to session). Deliberately **not** called "Action" alone — overloaded in software (UI button / Redux action / workflow action / automated remediation). v1 does not execute commands — copy/deep-link affordances only. |
| **Response** | What the user does with an observation: acknowledge, dismiss, snooze, resolve. |
| **Coach engine** | The evaluation runtime — loads enabled practices + their config, runs them (proposed: periodic tick, mirroring `reconciliation.js`'s R1/R2/R3 pattern), dedupes against already-open observations for the same practice+scope so it doesn't refire every cycle, persists new ones, broadcasts over WebSocket. |

### Additional modeling requirements (explicit, not incidental)
- Observations carry a `kind` (`opportunity` / `risk` / `reinforcement` /
  `reminder` / `standard`) **separate from** `severity` (`info` / `warning` /
  etc.). This is what lets the Coach recognize and praise good behavior, not
  just flag problems — a deliberate design requirement, since the Coach is
  meant to reinforce good patterns as well as flag risky ones.
- Deliberate ownership split in the data model: `playbook_*` tables hold the
  knowledge/config (owned by the Playbook — what a session's activity is
  measured against); `coach_*` tables hold what got produced (owned by the
  Coach — the actual observations). Rationale as stated: "the playbook
  defines knowledge; the Coach produces observations."

### Proposed (NOT YET BUILT) code/schema/API naming
- `server/lib/playbook/practices.js` — the catalog of practice definitions
- `server/lib/playbook/engine.js` — the tick/evaluator
- `server/lib/playbook/detectors/`, `server/lib/playbook/recommendations/`
- DB tables: `playbook_practice_config`, `coach_observations`,
  `coach_observation_responses`
- API: `GET/PUT /api/playbook/practices`, `PUT /api/playbook/practices/:id/config`,
  `GET /api/coach/observations`, `POST /api/coach/observations/:id/respond`

### Worked example anchoring the whole model
The `session-token-ceiling` practice (scope: `session`, config
`{ thresholdTokens: 100_000_000 }`) — when a session crosses 100M total
tokens, the Coach engine creates an observation recommending `/compact` or
`/clear`, with a suggested "copy session summary" action. It will not create
a duplicate observation while an equivalent one is still open for that
session.

## Decisions & rationale
- **Generalization over bespoke design**: Coach's engine/config shape was
  deliberately modeled on two things already working in this codebase
  (`reconciliation.js` tick+named-rules; Color Thresholds user-editable
  config) rather than invented fresh, on the theory that reuse of a proven
  shape reduces both design risk and cognitive load for whoever implements
  it.
- **Why not "Insight"**: too generic/overused across dashboards generally;
  didn't survive Sara's first revision pass.
- **Why not "Callout"**: confrontational/punitive connotation, wrong fit for
  a system meant to also give positive reinforcement; also ambiguous between
  "the UI card" and "the underlying detected event" — a distinction the
  final vocabulary (Observation vs. its rendering) makes explicit.
- **Why not "Alert"**: superseded early in the iteration; not discussed in
  depth but explicitly listed as rejected alongside Insight.
- **Why not bare "Action"**: the word is overloaded across the stack (UI
  button / Redux action / workflow action / automated remediation) — using
  "Suggested action" for the UI-facing label and `recommendation.actions`
  for the field name avoids this collision while keeping v1 non-executing
  (copy/deep-link only, no command execution).
- **Status**: naming/vocabulary decision only, confirmed 2026-08-01. Nothing
  built beyond the placeholder Coach page/route/sidebar entry. A future
  session building the actual Playbook/Coach-engine rule system should read
  this entry first.

## Related
- [[kb-product-naming-two-focus-concepts]] — another product-domain naming
  entry in this repo; same rationale for capturing naming decisions
  explicitly (avoid drift/conflation), different feature.
