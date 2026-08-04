# F3 Manual Double-Boot Walkthrough (Task 37) — 2026-08-03

Performed with Sara's explicit go-ahead ("proceed"), from the effort worktree's
new build (commit `3b9769e`), against copies of the real production DB. The
real `dashboard.db` was never booted against directly.

## Backup

- Live DB backed up via SQLite online backup (`.backup`, safe under WAL with
  the live dev server running) to:
  `~/.claude/agent-dashboard/dashboard.db.backup-2026-08-03-pre-practice-kind-override`
  (4.44 GB). All boots below ran against scratch copies of this backup, on
  `DASHBOARD_PORT=4899` (live server occupies 4820), with `DASHBOARD_DB_PATH`
  pointed explicitly at the copy.

## Material finding: production DB was ALREADY migrated

The production `coach_observations` table already carried
`CHECK(severity IN ('info','warning'))` and the quoted `"coach_observations"`
name (the rebuild's RENAME fingerprint) **before** this walkthrough — while
`master`'s DDL has no severity CHECK. The migration exists only on this
effort's branch, so the rebuild must have run against the real DB during the
build — almost certainly the pass-1 live-data-safety incident
(`verification.md` §1): early runs of T1b/T1c called `require("../db")`
without `DASHBOARD_DB_PATH` before the safety fix landed, booting the new
db.js against the default production path. The outcome happens to be healthy
(verified below), which is itself evidence the F1 atomic rebuild works — but
this confirms the incident the verifier flagged did actually touch production
once, and strengthens the case for the declined-so-far global
`DASHBOARD_DB_PATH` test-safety guard (recorded in the build report as the
TEST-AGAINST-LIVE-DB catalog candidate).

## Walkthrough A — as-is production copy (the state the merge will actually meet)

One boot of the new build. Result: idempotency guard correctly no-ops.

- No throw; server reached listening state.
- `sqlite_master` entries for `coach_observations` byte-identical before/after.
- All 50 rows byte-identical to the pre-boot dump.

## Walkthrough B — reconstructed pre-migration copy (proves the migration path)

Second copy downgraded to `master`'s exact legacy DDL (severity CHECK removed
via create-copy-drop-rename; both indexes recreated; 50 rows carried over) so
the rebuild genuinely runs on real data.

- **Boot 1 (migration runs):** no throw; table gains
  `CHECK(severity IN ('info','warning'))`; no `_old`/`_new` orphan tables;
  both `idx_coach_observations_open` and `idx_coach_observations_detected_at`
  present; all 50 rows byte-identical with original `id`s; zero rows outside
  the pinned `kind`/`severity` enums.
- **Boot 2 (idempotency):** no throw; full `sqlite_master` dump byte-identical
  before/after; rows still byte-identical to the original pre-migration dump.

## Locale check

All four locales (`en`, `vi`, `zh`, `ko`) carry `severityLabel` and
`playbook.useDefaultOption` keys in `coach.json` — no raw-key renders.

## Done-check verdict

Every Task 37 Done-check item met. **F3 PASSED — merge unblocked.**

## Side-finding (unrelated to this effort, needs follow-up)

`PRAGMA integrity_check` on the production copy reports 6 CHECK violations in
`detour_dispositions`: rows `63-67, 76` have `source='trunk_drift'`, which
violates the table's `CHECK(source IN ('inferred','declared'))`. `master`'s
`server/lib/value-ledger.js` documents `source='trunk_drift'` as "Phase 1b,
not shippable until the CHECK" is widened — so writer code got ahead of the
schema, and the rows somehow bypassed the constraint. Pre-existing on master;
belongs to the trunk-drift/value-ledger effort, not this one.
