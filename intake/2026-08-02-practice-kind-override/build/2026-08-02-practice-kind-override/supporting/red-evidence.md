# Red-Evidence — practice-kind-override loop-back pass (2026-08-02)

Implementer: `build-implementer`, loop-back pass fixing 3 blockers (B1-B3) and
9 should-fix items (S1-S9) surfaced by adversarial review, after 3 rounds of
`build-verifier` GREEN. Worktree:
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor`
(branch `effort/2026-08-02-practice-kind-override`).

This file records the one genuinely new red-first proof this pass needed:
**B3**'s new test case in
`server/__tests__/coach-observations-severity-rebuild.test.js`. (B1 and B2
were fixed by making existing/already-green tests exercise the corrected
code path — see the "B1/B2" section below for how those were confirmed, not
re-proven red-first from scratch, since no test needed to change shape for
them.)

---

## B3 — `rebuildTableAtomically()`'s `execute()` has no error handling

**New test**: `"coach_observations rebuild execute() failure handling (B3)"`
→ `'a mid-execute failure rolls back cleanly and does not throw out of
require("../db")'` (`server/__tests__/coach-observations-severity-rebuild.test.js`,
inserted directly after the existing T1b interruption-test block, modeled on
it per the build-task-list's instruction).

**Trigger used (real, unmocked):** a new helper,
`buildLegacyDbNoKindCheck()`, builds a fixture `coach_observations` table
with *no* CHECK constraint on `kind` or `severity` at all (more permissive
than any real legacy schema, which already CHECKs `kind`). It plants one row
with `severity: "info"` (valid — passes the WATCH-3 pre-flight scan, which
only inspects `severity`) but `kind: "bogus-kind-out-of-enum"` (invalid).
Pointing `DASHBOARD_DB_PATH` at this fixture and calling `require("../db")`
makes the real rebuild proceed past `isAlreadyMigrated` (no CHECK yet) and
past the pre-flight scan (severity is fine), then fail for real inside
`execute()`'s `INSERT INTO coach_observations_new SELECT * FROM
coach_observations` — the new table's `kind` CHECK genuinely rejects the
row, raising `SQLITE_CONSTRAINT_CHECK`. This is a legitimate stand-in for
the class of failure B3 targets (e.g. `SQLITE_BUSY` from a concurrent
lock-holder during the exclusive DROP/RENAME): whatever the cause,
`execute()` throwing partway through its own `BEGIN; ...` must not escape
`require("../db")`.

**Confirmed genuinely red-first** by manually reverting only the new
try/catch/rollback hunk in `rebuildTableAtomically()` (restoring the bare
`try { execute(); } finally { db.pragma("foreign_keys = ON"); }` shape) and
re-running just this test file:

```
not ok 1 - a mid-execute failure rolls back cleanly and does not throw out of require("../db")
  error: |-
    Got unwanted exception: db.js should not throw even when the rebuild's execute() fails mid-transaction (B3)
    Actual message: "CHECK constraint failed: kind IN ('risk','info','good')"
  code: 'ERR_ASSERTION'
  actual:
    code: 'SQLITE_CONSTRAINT_CHECK'
  operator: 'doesNotThrow'
```

i.e. without the fix, the SQLITE_CONSTRAINT_CHECK error genuinely propagates
out of `require("../db")` — confirming this is not a vacuous guard. With the
fix restored (try/catch that rolls back on `db.inTransaction` and returns
`false` instead of throwing, `finally` still restoring
`PRAGMA foreign_keys = ON`), the same test passes, and asserts:
- `require("../db")` does not throw,
- `db.js`'s own connection (`dbModule.db.inTransaction === false`) has no
  transaction left open after the failure,
- the main `coach_observations` table still lacks
  `CHECK(severity IN` (rebuild genuinely did not complete),
- no orphaned `coach_observations_old`/`coach_observations_new` tables remain
  (SQLite's transactional DDL means the `ROLLBACK` undoes the `CREATE TABLE
  coach_observations_new` too),
- the offending row (`kind: "bogus-kind-out-of-enum"`, `severity: "info"`) is
  preserved byte-identical — nothing was silently rewritten or dropped.

Full-file result after the fix: 15/15 tests pass
(`node --test server/__tests__/coach-observations-severity-rebuild.test.js`).

---

## B1/B2 — confirmed via existing test coverage, not new red-first proof

- **B1** (`playbookStore.ts`'s `save()` reimplementing the resolution formula
  inline instead of calling `resolveDraftKind`/`resolveDraftSeverity`): no
  new test was needed — the existing parity/unit tests in
  `client/src/lib/__tests__/playbookStore.test.ts` and
  `server/__tests__/playbook-resolver-parity.test.js` already exercise
  `resolveDraftKind`/`resolveDraftSeverity` directly (including their
  enum-coercion fail-safe via the shared fixture's out-of-enum rows); the fix
  routes `save()`'s optimistic merge through those already-covered
  functions instead of a parallel inline formula that had zero direct
  coverage of its own divergence from them.
- **B2** (preview cards never actually reading the server's
  `resolvedKind`/`resolvedSeverity`): confirmed by inspection — before the
  fix, `grep -rn "resolvedKind\|resolvedSeverity"` across `client/src`
  outside `types.ts`/`playbookStore.ts` had zero call sites reading those
  fields; after the fix, `PlaybookPage.tsx`'s two preview-card call sites
  read `practice.resolvedKind` whenever `kindDraft === undefined`. No
  existing or new automated test asserts "the served field is read", since
  distinguishing "read the served value" from "read the client-recomputed
  value that happens to equal it" requires a fixture where the two diverge
  (server round-trip vs. local formula disagreeing) — out of scope for this
  pass; the full server + client suites (1300 + 699 tests) pass unchanged
  with the fix in place, and `npm run build` (forced clean rebuild) is
  green.

---

## Full suite results after all B1-B3 / S1-S9 fixes

- `node --test server/__tests__/*.test.js`: **1300 passed, 0 failed** (280
  suites).
- `npx vitest run` (client): **699 passed, 0 failed** (59 test files).
- `rm -rf tsconfig.tsbuildinfo dist && npm run build` (client, forced clean
  rebuild): **green** (`tsc -b && vite build` succeeds).
