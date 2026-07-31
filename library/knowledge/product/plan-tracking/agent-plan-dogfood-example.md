---
id: kb-product-plan-tracking-agent-plan-dogfood-example
domain: product
subdomain: plan-tracking
title: This repo's own root AGENT-PLAN.md is the canonical worked example of the Plan Tracking feature's file format
description: >-
  Load when building, testing, documenting, or debugging the Plan Tracking
  feature (`ccam focus`, AGENT-PLAN.md parsing, plan-progress display, drift
  detection) and you need a real, in-repo example file to point at, parse
  against, or copy the format from, instead of inventing a synthetic one.
  Also load when explaining what "plan tracking" looks like to someone
  unfamiliar with the feature.
tags: [plan-tracking, agent-plan, ccam-focus, dogfooding, checkbox-format]
status: active
created: 2026-07-30
updated: 2026-07-30
source: observed while running a release-story dogfood session in Claude-Code-Agent-Monitor (2026-07-30)
---

# This repo's own root AGENT-PLAN.md is the canonical worked example of the Plan Tracking format

## What this is
The Plan Tracking feature (checkbox items with an `— acceptance: ...` suffix,
parsed for progress display and `ccam focus` drift detection) has a **real,
dogfooded example already living in this repo**: the root-level
`AGENT-PLAN.md`. It is not a toy/fixture file — it's the project's own
actual plan, using its own feature to track itself. Format, e.g.:

```
- [x] 1. Live Monitoring: Sessions and agents update instantly as Claude Code works. — acceptance: activity appears in the dashboard in real time
- [ ] 6. MCP Reliability: Make the local MCP tools something you can always count on. — acceptance: MCP tools work reliably, every time
```

(`[x]`/`[ ]` checkbox, numbered item, free-text title, then a literal
`— acceptance: ...` suffix describing the done-criterion.)

## Why it matters / the problem it solves
Any time you need a concrete, correctly-formatted example of what a plan file
looks like — to write a parser test fixture, to demo the feature, to
document the format, or to sanity-check that a change to the plan-parsing
logic still handles real content — this file is the ready-made ground truth,
already exercised by the live dashboard (this repo's own dashboard instance
tracks its own `AGENT-PLAN.md`). No need to hand-roll a synthetic example
from scratch.

## How (the durable knowledge)
- File location: `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/AGENT-PLAN.md`
  (repo root).
- Format: `- [x|  ] <n>. <title>. — acceptance: <criterion>` per line.
- Treat it as a live document — it reflects the project's actual current
  plan state (as of 2026-07-30, items 1-5 done, item 6 "MCP Reliability" not
  yet done), so don't assume its content is static/frozen when using it as a
  reference; re-check it rather than assuming past captured content still
  matches.

## Decisions & rationale
No decision made here — this is a "where's a real example" pointer, captured
because it was useful during this session and not previously noted anywhere
in the library.

## Related
- [[kb-product-naming-two-focus-concepts]] — AGENT-PLAN.md is also the
  document `ccam focus` declarations point into; that entry explains why
  "Focus" is ambiguous between this feature and the unrelated dashboard
  Focus-time analytics.
