# Project Context

## Repo topology

Confirmed 2026-07-31 via the `worktree` skill's `story-discovery` pass.

- **Claude-Code-Agent-Monitor** (this repo) — self-contained monorepo.
  Bundles every surface of the product under one root: Express/SQLite
  server, React+Vite client, MCP server, desktop (Electron) app, VS Code
  extension, and monitoring stack. No separate sibling repo exists — this
  is a single-repo solution.

**Explicitly excluded:**
- No candidates found. Sibling directories under `~/CODE-LOCAL/SARA/*`
  were scanned for a matching git remote (`hoangsonww`, `agent-monitor`,
  `claude-code-agent`, `ccam`) — none matched. Desktop and VS Code
  extension sub-packages declare the same repo URL as the root
  `package.json`, confirming they're part of this repo, not standalone.

## Recurring defect-class patterns

Named patterns this project has independently rediscovered more than once.
Cite by name in review when a change touches the surface described.

### 9.1 DERIVED-DUAL-VIEW

A derived/summary value (e.g. `wall_ms`, `active_ms`, a concurrency ratio) is
computed once — server-side, in `server/lib/focus-report.js` — and consumed
by multiple independent client rendering surfaces. A fix or new field applied
to one consumer does not automatically apply to the others unless the value
and its rendering are shared via an extracted component/hook, not
hand-copied.

**Flagged in:** `intake/2026-07-26-focus-calendar-board/`,
`intake/2026-07-26-focus-report-fidelity/`,
`intake/2026-07-31-focus-untracked-commits/` (this item — 4th touch).

**Acceptance criterion:** same field, same value, across every consumer of a
given `FocusReport`, enforced by a cross-consumer test — not eyeballing two
UIs. See `client/src/components/__tests__/FocusReportModal.test.tsx`'s
`[standing template]`/`[board-mode extension]`/`[FocusPage extension]` tests
(search `extend THIS test`) for the live implementation of this criterion.

**How to comply:** extract a shared component/hook (see
`HourWindowZoomBar`/`useHourWindowZoom`, `StatTile`/`ConcurrencyStatTile`,
`ProjectScopeFilters` for precedent) rather than reimplementing a formula in
a new consumer. If client-side duplication is genuinely unavoidable (a real
UX cost to a server round-trip), document it in the introducing file's own
header the way `client/src/lib/windowedTotals.ts` does: name the risk
explicitly, explain why extraction wasn't possible, and state the bound on
how far the duplicated value can diverge from the canonical one.

**Known bounded exception:** `client/src/lib/windowedTotals.ts` —
client-side re-slice of the same 10-minute `chunks` grid the Calendar's idle
stripes already render from (not a re-derivation from raw events), bounding
drift from the server's own number to ≤1 chunk (10 min) at a window boundary.

### 9.2 row-id-as-chronology-proxy

A query or aggregation over a table with an auto-increment `id` assumes
`ORDER BY id ASC/DESC` reflects real chronological (`created_at`) order.
Breaks once `server/lib/workflow-ingest.js` bulk-inserts events after the
fact — those rows land at whatever `id` is next, regardless of their own
`created_at`.

**Flagged in:** `6e9a443` (2026-04-26, `client/src/pages/SessionDetail.tsx`,
display-ordering), `b3a2cc9` (2026-07-27, `server/lib/focus-report.js`,
arithmetic double-counting — real session confirmed with 7,152/8,117 events
out-of-order by id), and the `focus-inference.js` `buildActivityDigest()` fix
in `intake/2026-07-31-focus-untracked-commits/` (3rd instance, found live and
unaudited during this retroactive review, same batch as `b930824`'s AI
window-summary feature that consumes it).

**Acceptance criterion:** any code that walks `events` (or any other table
`workflow-ingest.js` bulk-inserts into) for chronological logic must sort by
`created_at` explicitly — never rely on `id` order alone. When a `LIMIT` is
applied in the same query, the `created_at` sort must happen **before** the
`LIMIT`, not after, since an id-ordered `LIMIT` can select the wrong subset
of rows entirely, not just present a correct subset in the wrong order.

**How to comply:** `ORDER BY created_at ASC/DESC, id ASC/DESC` (id as
tiebreak for equal timestamps) — this project's own established convention,
already used throughout `server/db.js` (`listEvents`,
`getEventsBySessionSince`, `webhook_deliveries` queries). `events.created_at`
is fixed-width ISO-8601 text, already indexed
(`idx_events_created ON events(created_at DESC)`) — no schema change needed
to comply.
