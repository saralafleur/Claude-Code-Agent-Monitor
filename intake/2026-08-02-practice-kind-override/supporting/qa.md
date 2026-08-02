# QA / Test Plan — Per-Practice `kind` (and `defaultSeverity`) Override

Surface: Coach's Playbook (`server/lib/playbook/practices.js`,
`server/lib/playbook/engine.js`, `server/routes/playbook.js`,
`server/db.js`, `client/src/pages/PlaybookPage.tsx`,
`client/src/lib/playbookStore.ts`).

Test stack (confirmed from `package.json` + existing spec files, no
separate test-stack doc in `PROJECT-CONTEXT.md`):
- Server: Node's built-in test runner (`node:test` + `node:assert/strict`).
  Run the whole server suite: `npm run test:server` (`node --test
  server/__tests__/*.test.js`). Run one file directly: `node --test
  server/__tests__/playbook.test.js`. Node's test runner has no single-test
  `-t` name filter the way Jest/Vitest do; isolate a case by temporarily
  using `it.only(...)` in the file, or by narrowing to the one file (there
  is no per-test CLI grep here).
- Client: Vitest + Testing Library (`npm run test:client`, i.e. `cd client
  && npm test`). Single file: `cd client && npx vitest run
  src/pages/__tests__/PlaybookPage.test.tsx`. Single test name: add
  `-t "<test name>"`.
- Both: `npm test` (root) runs server then client.

## 1. How we verify done

Manual (dev server, real DB):
1. Start the app, open Playbook config UI (`/coach/playbook`), find the
   Account Rotation (`account-weekly-balance`) card. Confirm it now shows a
   `kind` selector (Warning / Reminder / Reinforcement) alongside its
   existing numeric field, defaulted to the catalog value ("Reminder").
2. Trigger the practice to fire with no override set (e.g. seed two
   accounts with a sufficient weekly-pct gap, or wait for a natural tick).
   Confirm the resulting Feed item is labeled "Reminder" and
   `coach_observations.kind` is `info`.
3. In the UI, set the override to "Warning" and save. Confirm `GET
   /api/playbook/practices` now reports the practice's live `kind` as
   `risk`, and the previously-created Observation's Feed label is
   unchanged ("Reminder") — it must NOT flip to "Warning" retroactively.
4. Force the practice to fire again (dismiss/resolve the open Observation
   so dedup allows a re-fire, then re-trigger the gap condition). Confirm
   the NEW Observation is labeled "Warning" (`kind: "risk"`), while the
   earlier Observation from step 2 is still "Reminder".
5. Clear the override (or change it to a third value, e.g. "Reinforcement")
   and confirm both prior Observations (steps 2 and 4) still show their
   original frozen labels — no observation's `kind` ever changes after the
   fact.
6. Confirm `vi`/`zh`/`ko` `coach.json` all have the three `kindLabel` keys
   the selector reuses (per the brief's open question 5, no independent
   check done yet) — this is a doc/i18n completeness check, not a
   behavior test, but should be confirmed once before calling this done.

Automated: see section 3 below — the automated version of steps 2–5 is the
required regression test and must be added, not just eyeballed manually.

## 2. Regression coverage — existing tests, current status

Directly relevant spec files (found by grepping `server/__tests__/` and
`client/src/pages/__tests__/` for `playbook`/`coach`):

- `server/__tests__/playbook.test.js` — engine tick/evaluateSession/
  evaluateGlobal (fire, dedup, disabled gate, numeric-threshold overrides)
  and the `/api/playbook/practices` + `/api/coach/observations` HTTP
  routes. This is the file that must gain the new kind/severity-override
  coverage — it already has the exact `dbModule.stmts.
  upsertPlaybookPracticeConfig.run(...)` + `engine.tick(dbModule)` pattern
  the new tests need, and its route-level `describe` block already exercises
  `PUT /api/playbook/practices/:id/config` config-patch validation
  (`INVALID_CONFIG` on unknown field / below-minimum value) that a
  string-enum override must extend correctly.
- `server/__tests__/db-migration.test.js` — only relevant **if** the build
  picks the dedicated-column route for the override (see §9.5 below); not
  otherwise.
- `client/src/pages/__tests__/PlaybookPage.test.tsx` — practice-card
  rendering + save-button wiring for both existing practices
  (`session-token-ceiling`, `account-weekly-balance`). Needs a new
  `describe`/`it` block for the kind selector once it exists.

Current status as of this writing: I ran neither suite as part of this QA
pass (no build has landed yet — `practices.js`/`engine.js`/`routes/
playbook.js` still only support numeric-field overrides, confirmed by
reading them: `resolvePracticeConfig()` only merges `typeof value ===
"number"` fields, and `evaluateSession`/`evaluateGlobal` still pass the
bare `practice.kind`/`practice.defaultSeverity` unconditionally into
`insertCoachObservation.run(...)`). Both spec files pass today against
the pre-change code (they don't yet assert anything about kind/severity
overrides, so there's nothing in them for this feature to have broken
yet) — confirm with `npm run test:server && npm run test:client` before
starting the build, to have a clean baseline.

## 3. New/updated tests required

### 3a. `server/__tests__/playbook.test.js` — the critical regression test

This is the test that proves the frozen-snapshot invariant. Add it to the
`describe("playbook engine", ...)` block, next to the existing
`"respects a raised account-weekly-balance gap threshold override"` case,
using the same `seedAccount`/`dbModule.stmts.upsertPlaybookPracticeConfig`
pattern:

```
it("freezes an Observation's kind at fire time; a later kind-override change never relabels it", () => {
  // (1) fire with no override -> built-in kind ("info" / Reminder)
  seedAccount("acct-a", "Personal", 80);
  seedAccount("acct-b", "Work", 40);
  const firstBatch = engine.tick(dbModule);
  const firstObs = firstBatch.find((o) => o.practice_id === "account-weekly-balance");
  assert.ok(firstObs, "expected account-weekly-balance to fire with no override");
  assert.equal(firstObs.kind, "info", "no override set -> built-in catalog kind");

  // dismiss so a second fire is allowed (same dedup pattern as the
  // existing "fires again once the prior observation has been responded
  // to" case)
  dbModule.stmts.updateCoachObservationStatus.run("dismissed", firstObs.id);

  // (2) set an override -> risk/Warning
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    "account-weekly-balance",
    1,
    JSON.stringify({ gapThresholdPct: 25, kind: "risk" })
  );

  // (3) fire again -> new observation gets the OVERRIDDEN kind
  const secondBatch = engine.tick(dbModule);
  const secondObs = secondBatch.find((o) => o.practice_id === "account-weekly-balance");
  assert.ok(secondObs, "expected a second observation to fire after override + dismiss");
  assert.equal(secondObs.kind, "risk", "override set -> overridden kind on the NEW observation");

  // (4) change the override again (a third value) -- and separately clear it
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    "account-weekly-balance",
    1,
    JSON.stringify({ gapThresholdPct: 25, kind: "good" })
  );

  // (5) confirm EARLIER observations' kind is unchanged, i.e. no retroactive
  // relabeling of already-created (now-dismissed) rows
  const persistedFirst = dbModule.stmts.getCoachObservation.get(firstObs.id);
  const persistedSecond = dbModule.stmts.getCoachObservation.get(secondObs.id);
  assert.equal(persistedFirst.kind, "info", "pre-override observation must stay frozen at its original kind");
  assert.equal(persistedSecond.kind, "risk", "prior-override observation must stay frozen even after a further config change");
});
```

Notes on this test:
- Uses `account-weekly-balance` (matches the brief's own worked example,
  Account Rotation) rather than `session-token-ceiling`, but the same
  shape should also be proven once for the session-scoped practice if the
  override mechanism is truly generic (per the brief's open question 2) —
  add a twin case using `seedSession`/`seedTokens` +
  `session-token-ceiling` if scope-specific code paths diverge at all in
  the implementation (they share `resolvePracticeConfig`, so one thorough
  case per scope type, not per practice, is likely sufficient — use
  judgment based on the actual diff).
- Deliberately does **not** assert "the live resolved kind equals the
  stored kind" anywhere — see the §9.1 caution below.
- If `defaultSeverity` also gets an override in this build (open question
  3), mirror the same five-step shape for `severity` alongside `kind` in
  the same test (or a twin test) rather than only covering `kind`.

### 3b. `server/__tests__/playbook.test.js` — route-level coverage

Extend the `describe("PUT /api/playbook/practices/:id/config", ...)`
block:
- `"persists a kind override and a follow-up GET reflects the live resolved kind"`
  — PUT `{ config: { kind: "risk" } }` to `account-weekly-balance`, assert
  the response and a follow-up `GET /api/playbook/practices` both report
  `config.kind: "risk"` (or wherever the resolved override surfaces in the
  serialized shape — follow whatever field name the actual implementation
  picks, e.g. top-level `kind` vs. nested in `config`).
- `"400s on an invalid kind value"` — PUT `{ config: { kind: "not-a-real-kind" } }`,
  assert `400` / `INVALID_CONFIG` (or a new dedicated error code if the
  build introduces one) — mirrors the existing `"400s on an unknown
  config field"` / `"400s on a value below the field's minimum"` cases,
  extended to validate an enum instead of a numeric minimum.
- If `kind` is optional/unset-to-default: `"clearing a kind override reverts to the practice's built-in kind"`
  — set an override, then PUT with an explicit "unset" sentinel (whatever
  the implementation chooses — `null`, an absent key with a reset flag,
  etc.) and assert the resolved `kind` in a follow-up GET returns to the
  catalog default. Do not assume this exists — confirm against how the
  actual PUT contract handles clearing (open question in the brief itself
  is silent on the exact clear-mechanism).
- A sanity check that an *unrelated* practice's kind stays at its
  catalog default when only `account-weekly-balance`'s is overridden
  (no cross-practice bleed) — cheap to add given `GET /api/playbook/practices`
  already returns the full catalog in one call.

### 3c. `server/__tests__/db-migration.test.js` — only if a dedicated column is chosen

Per the brief's §9.5 flag: **only applies if the team extends
`playbook_practice_config` with a new dedicated column** (e.g. `kind_override
TEXT`) rather than folding the override into the existing generic `config`
JSON blob. If a dedicated column is chosen:
- The `CREATE TABLE IF NOT EXISTS playbook_practice_config` body must gain
  the column, guarded by a `PRAGMA table_info`-checked `ALTER TABLE …
  ADD COLUMN` (not the old try/SELECT/catch probe — see the file's own
  guidance) for existing installs.
- Add a `UPGRADE_CASES` entry: `table: "playbook_practice_config"`,
  `column: "kind_override"` (or whatever name is chosen), with `legacySql`
  reproducing the pre-change table shape (no `kind_override` column), a
  `seed()` that inserts a legacy row for a real practice id (e.g.
  `account-weekly-balance`) with just `enabled`/`config`, `assertLegacyRow`
  asserting the new column reads `NULL` on that legacy row, and
  `assertWritable` asserting the column accepts a write on the legacy row
  (e.g. via `stmts.upsertPlaybookPracticeConfig.run(...)` or a raw
  `UPDATE`, matching the pattern the `detour_dispositions.project_id`/
  `projects.pinned` cases already use).
- The suite's own `"Migration meta-test"` (in the same file) auto-fails any
  new `ALTER TABLE … ADD COLUMN` in `db.js` that isn't covered by an
  `UPGRADE_CASES` entry or `GRANDFATHERED` — do not add the new column to
  `GRANDFATHERED`; that list is explicitly frozen ("do not add to this
  array").
- **If instead the override is folded into the existing generic `config`
  JSON** (the other option the brief leaves open, and the one requiring
  zero schema change), none of 3c applies — `playbook_practice_config`'s
  shape is untouched, only `resolvePracticeConfig()`'s field-merging logic
  (currently `typeof value === "number"` only) needs to also accept a
  string/enum field type. This is the cheaper, lower-risk route from a
  migration-test-burden standpoint and should be preferred unless there's
  a concrete reason a dedicated column is needed.

### 3d. `client/src/pages/__tests__/PlaybookPage.test.tsx`

Add to the existing `describe("PlaybookPage", ...)` block, following the
file's established `PRACTICE`/`ACCOUNT_BALANCE_PRACTICE` fixture + mocked
`api.playbook` pattern:
- `"renders a kind selector defaulted to the practice's current kind"` —
  render with `ACCOUNT_BALANCE_PRACTICE` (kind: "info"), confirm the
  selector shows "Reminder" selected (reusing the `kindLabel` i18n keys
  per the brief).
- `"changing the kind selector and saving calls api.playbook.updatePracticeConfig with the overridden kind"`
  — select "Warning", click "Save changes", assert
  `updatePracticeConfig` was called with a config payload containing the
  overridden kind field — mirrors the existing `"applying a preset chip
  sets the threshold..."` / `"saves an enabled/threshold change..."` save
  tests' `waitFor(() => expect(updatePracticeConfig).toHaveBeenCalledWith(...))`
  shape.
- `"does not show a live/frozen-value warning as an error"` (soft,
  optional) — since this UI only ever shows the *live* resolved kind, not
  any specific Observation's frozen value, there's no dual-value
  cross-check needed in this component at all — the divergence this
  feature intentionally creates lives entirely in `coach_observations`,
  never in this config screen. Worth a one-line comment in the test file
  itself (not just this doc) so a future contributor doesn't misread §9.1
  and add a spurious "UI must match Feed" assertion here.

## 4. Test data / fixtures

- Reuse `server/__tests__/playbook.test.js`'s existing `seedAccount(id,
  label, weeklyUsedPct)` / `seedSession(id)` / `seedTokens(sessionId,
  total)` helpers — no new fixture infrastructure needed.
- Practice under test: `account-weekly-balance` (built-in `kind: "info"`,
  the brief's own worked example — Account Rotation). Two accounts with a
  weekly-pct gap ≥ the configured `gapThresholdPct` (e.g. 80/40, already
  used by three existing tests in the file) reliably fires it.
- Override values to exercise: the override set (`kind: "risk"`), a
  further change (`kind: "good"`), and (if clearing is supported) an
  explicit clear back to the built-in `"info"`. Exercise all three
  `risk`/`info`/`good` values at least once each across the new tests,
  since open question 5 assumes all three are freely selectable.
- Client fixture: extend the existing `ACCOUNT_BALANCE_PRACTICE` object
  in `PlaybookPage.test.tsx` (or clone it) to include whatever new field
  the API contract adds for the resolved/override kind — don't invent a
  parallel fixture shape.

## 5. Definition of Done checklist

- [ ] `resolvePracticeConfig()` accepts a `kind` (and `defaultSeverity`,
      if in scope) override alongside existing numeric fields, defaulting
      to the practice's catalog value when unset.
- [ ] `evaluateSession()`/`evaluateGlobal()` in `engine.js` pass the
      **resolved** kind/severity (catalog + override) into
      `insertCoachObservation.run(...)`, not the bare `practice.kind`/
      `practice.defaultSeverity`.
- [ ] New automated test (3a) passes: fire → override → fire again →
      change/clear override → assert both prior Observations' `kind`
      values are byte-for-byte unchanged. This is the load-bearing test;
      it must fail against the pre-change code and pass after.
- [ ] Route-level tests (3b) cover a valid override PUT, an invalid-value
      400, and (if applicable) clearing back to default.
- [ ] If a dedicated DB column was chosen: `db-migration.test.js` has a
      new `UPGRADE_CASES` entry (3c) and the meta-test passes without
      adding the column to `GRANDFATHERED`.
- [ ] `PlaybookPage.test.tsx` covers the new kind selector rendering and
      its save-path wiring (3d).
- [ ] `vi`/`zh`/`ko` `coach.json` confirmed to carry the same three
      `kindLabel` keys as `en` (manual check, item 6 in section 1) —
      file a follow-up if any locale is missing a key rather than
      blocking on a full translation pass.
- [ ] Full suite green: `npm run test:server && npm run test:client`
      (or root `npm test`).
- [ ] Manual walkthrough (section 1, steps 1–5) performed once against a
      running dev server/DB, not only the automated suite.
- [ ] No test in this change asserts "live resolved kind == stored
      Observation kind" post-override — that would misapply §9.1
      DERIVED-DUAL-VIEW's usual "same value everywhere" shape to a
      surface that is intentionally allowed (expected) to diverge.
