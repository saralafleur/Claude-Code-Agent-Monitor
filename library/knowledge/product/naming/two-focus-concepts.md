---
id: kb-product-naming-two-focus-concepts
domain: product
subdomain: naming
title: Two unrelated "Focus" features share the name in this codebase — session Focus-time analytics vs. `ccam focus` plan-item declaration
description: >-
  Load whenever a task, bug report, or request mentions "Focus" anywhere in
  Claude-Code-Agent-Monitor — `FocusPage.tsx`, `FocusCalendarBoard.tsx`,
  `FocusReportModal`/`FocusReportBody`, AGENT-PLAN.md, or CLI usage like
  `ccam focus set/push/pop/done/status` — before writing code, docs, or
  answering a question, to make sure the right "Focus" is meant. These are
  two genuinely different features that happen to share a name and are easy
  to conflate.
tags: [naming, focus, cli, ux, disambiguation]
status: active
created: 2026-07-29
updated: 2026-07-29
source: observed while working on ConcurrencyStatTile / Focus report UI in this session
---

# Two unrelated "Focus" features share the name — session Focus-time analytics vs. `ccam focus` plan-item declaration

## What this is
This codebase has **two distinct, unrelated features both called "Focus"**:

1. **Dashboard "Focus" (session/time analytics)** — `client/src/pages/FocusPage.tsx`,
   `FocusCalendarBoard.tsx`, `FocusReportModal.tsx`/`FocusReportBody.tsx`. This
   is a per-project / cross-project **time-accounting view**: how much wall
   clock and active-agent time was spent, concurrency ratios
   (`ConcurrencyStatTile`), etc.
2. **CLI `ccam focus` (plan-item declaration)** — `bin/ccam.js`'s
   `focus set/push/pop/done/bug/feature/status` subcommands. This shows/edits
   **which `AGENT-PLAN.md` item a session is currently declared to be working
   on** — a stack of "what am I doing right now" declarations, with drift
   detection against actual activity, entirely unrelated to time totals.

## Why it matters / the problem it solves
The shared name is a trap: a request like "fix the focus page" or "the focus
report is wrong" is ambiguous without more context, and it's easy to go edit
the wrong subsystem (e.g. touch `ccam focus`'s drift-detection logic when the
actual ask was about the dashboard's `ConcurrencyStatTile` time totals, or
vice versa). This has already caused confusion once in this project's own
work sessions.

## How (the durable knowledge)
When "Focus" comes up, quickly classify which one is meant:
- Mentions of a **UI page/tile/modal, wall-clock time, concurrency ratio,
  calendar** → dashboard Focus-time analytics (`FocusPage`/`FocusCalendarBoard`/
  `FocusReportModal`).
- Mentions of **`ccam focus`, AGENT-PLAN.md, plan items, "declared focus",
  drift, detour stack** → CLI plan-focus feature (`bin/ccam.js`).
- If genuinely ambiguous from the request text, ask which one before editing.

## Decisions & rationale
No renaming was undertaken in this session — this entry exists purely to
prevent re-deriving the "wait, which Focus is this" confusion next time,
not to argue the two features should be renamed (that would be a larger,
separate call involving user-facing strings/docs/CLI help text).

## Related
- [[kb-frontend-ui-decisions-concurrency-stat-tile-default]] — lives specifically in the dashboard-analytics "Focus," not the CLI one.
