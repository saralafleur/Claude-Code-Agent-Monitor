---
id: kb-frontend-ui-decisions-concurrency-stat-tile-default
domain: frontend
subdomain: ui-decisions
title: Decision — ConcurrencyStatTile defaults to "active" (not "open") as its primary ratio
description: >-
  Load when working on `client/src/components/ConcurrencyStatTile.tsx`, the
  `agent-monitor-concurrency-primary` localStorage key, `FocusReportBody` /
  `FocusReportModal`, `FocusCalendarBoard`, or `FocusPage` concurrency
  displays — or when asked "why does the concurrency tile default to X" /
  asked to change the default again. Distinguishes open-session-wall-clock
  concurrency from active-agent-time concurrency.
tags: [concurrency, focus-report, ui-default, localStorage, decision]
status: active
created: 2026-07-29
updated: 2026-07-29
source: explicit user request during this session to flip the tile's default
---

# Decision — ConcurrencyStatTile defaults to "active" (not "open") as its primary ratio

## What this is
`ConcurrencyStatTile` (shared by `FocusReportBody`/`FocusReportModal`,
`FocusCalendarBoard`, and `FocusPage`) shows a concurrency ratio that can be
computed two ways:
- **"open"**: effort ÷ open-session wall-clock time (`concurrency_ratio`).
- **"active"**: effort ÷ active-agent wall-clock time (`active_concurrency_ratio`).

Which one is "primary" (shown big, with the other as a small secondary line)
is user-togglable via a swap (⇄) button, and persists in `localStorage` under
`agent-monitor-concurrency-primary`. **The default (what a fresh
`localStorage` / new user sees) was changed from `"open"` to `"active"`** —
see `loadPrimary()`'s fallback branch in `ConcurrencyStatTile.tsx`.

## Why it matters / the problem it solves
This was an explicit, deliberate user preference change, not a bug fix or a
derived technical necessity — if this default is ever questioned again
("why does it show active-time by default, shouldn't open-session be the
default"), the answer is: it was flipped on purpose, per direct request,
during this session. Re-flipping it without checking here would relitigate a
decision that was already made intentionally.

## How (the durable knowledge)
`loadPrimary()` reads `localStorage.getItem(CONCURRENCY_PRIMARY_KEY)`; if the
stored value is exactly `"open"` it returns `"open"`, otherwise (including
absent/corrupt storage) it returns `"active"`. The toggle button always lets
either user override to the other option at any time — this change only
affects what a brand-new user / cleared `localStorage` sees first.

## Decisions & rationale
- Chose to default new users to **active-time-based** concurrency (effort per
  unit of actual agent activity) rather than open-session-wall-clock-based
  concurrency, per explicit user direction in this session.
- Road not taken: leaving `"open"` as default and only changing labeling/order
  — rejected because the ask was specifically about which ratio a first-time
  viewer sees, not about presentation order.
- The toggle mechanism itself, and both ratios being computed and available,
  were not changed — only the fallback branch of `loadPrimary()`.

## Related
- [[kb-product-naming-two-focus-concepts]] — this tile lives inside the dashboard's session Focus-time analytics views, not the CLI's plan-focus feature.
