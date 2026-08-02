# Change Brief — practice-kind-override

> Authored by `qa-triage`. The single normalized statement of *what we just
> changed*, before any coverage evaluation.

- **Date:** 2026-08-02
- **Scope source:** intake-handoff (nothing built yet — this is a pre-build
  technical-plan hand-off; confirmed all described starting-state code claims
  against the actual current tree, see "Confirmation against actual code"
  below)
- **Intake link:** `intake/2026-08-02-practice-kind-override/` —
  `technical-plan.md` (authoritative build spec), `pm-plan.md`,
  `decisions.md` (DEC-1…DEC-5, WATCH-1…WATCH-3), `supporting/{architect,
  engineer,qa,product-owner}.md`

## Confirmation against actual code (done live, this pass)

Every "current shape" claim the technical plan makes was re-read directly
against the working tree at HEAD (`f78b2ec`) — not just trusted from the
plan — since the plan was authored earlier today and other work could in
principle have landed on this surface since. Nothing has. All confirmed
exactly as described:

| Plan claim | File:line | Verified |
|---|---|---|
| `resolvePracticeConfig()` merges only `typeof value === "number"` fields; no kind/severity path | `server/lib/playbook/practices.js:101-117` | Exact match |
| `evaluateSession()` passes bare `practice.kind, practice.defaultSeverity` | `server/lib/playbook/engine.js:93-100` | Exact match |
| `evaluateGlobal()` passes bare `practice.kind, practice.defaultSeverity` | `server/lib/playbook/engine.js:141-147` | Exact match |
| `serializePractice()` reads `practice.kind`/`practice.defaultSeverity` directly | `server/routes/playbook.js:33-46` | Exact match |
| `validateConfigPatch()` rejects any patch key not in `practice.fields` | `server/routes/playbook.js:52-70` | Exact match |
| `coach_observations.kind` has `CHECK(kind IN ('risk','info','good'))`; `severity` is `TEXT NOT NULL`, **no** CHECK | `server/db.js:1372-1373` | Exact match |
| Comment recording "SQLite cannot add a CHECK via ALTER TABLE ADD COLUMN" already exists in this file (re: a different table) | `server/db.js:672` | Exact match — DEC-15/WATCH-4 comment on `detour_dispositions`, confirms the constraint the plan relies on |
| Precedent guarded-rebuild patterns exist (`plan_items` item_id rebuild, `webhook_targets`, `agents`) | `server/db.js:749ff`, `~1427-1461`, `~1465-1513` | Confirmed present, same `sqlite_master.sql`-text-guard shape the plan's Step 2 models on |
| `PlaybookPractice` (client) has no `kindOverride`/`severityOverride`/`resolvedKind`/`resolvedSeverity`; `defaultSeverity: string` (not a union) | `client/src/lib/types.ts:2494-2508` | Exact match |
| `updatePracticeConfig` patch type is `{ enabled?; config?: Record<string, number> }` | `client/src/lib/api.ts:2170-2177` | Exact match |
| `playbookStore.save()` patch type mirrors `api.ts`, same numeric-only shape | `client/src/lib/playbookStore.ts:117-133` | Exact match |
| Both cards pass bare `kind={practice.kind}` into the live-preview `<ObservationCard>` | `client/src/pages/PlaybookPage.tsx:257`, `:335` | Exact match |
| `kindLabel` (`risk`/`info`/`good`) present and structurally identical in all four locales; no `severityLabel` anywhere | `client/src/i18n/locales/{en,vi,zh,ko}/coach.json:16-20` | Exact match |
| Vocabulary doc's `kind` enum still reads the stale `opportunity/risk/reinforcement/reminder/standard` | `library/knowledge/product/coach/coach-playbook-vocabulary.md` (~line 98) | Exact match |
| `playbook-resolver-guard.test.js` does not yet exist; `single-writer-guard.test.js` / `chronology-ordering.test.js` exist as the structural-guard precedent the new file is modeled on | `server/__tests__/` | Confirmed |
| `db-migration.test.js`'s meta-test only scans `ALTER TABLE … ADD COLUMN` (won't auto-catch a table rebuild) | `server/__tests__/db-migration.test.js:25-26, 714-746` | Confirmed — `GRANDFATHERED`/`UPGRADE_CASES` shape present, no entry for a rebuild-only migration |

**No drift found.** The plan's described starting state is still accurate
right now. Nothing else has landed on this surface since the plan was
written. Git status shows a large amount of unrelated in-flight work in the
tree (Projects/pin-to-top, account-activity/-capture-scheduler, intake-scan,
repo-topology — none of it touches `server/lib/playbook/`, `server/db.js`'s
`coach_observations`/`playbook_practice_config` bodies, `server/routes/
playbook.js`, or any Playbook client file).

## Change summary

Add a generic, per-practice operator override of a Coach Playbook practice's
`kind` and `defaultSeverity` (stored in the existing `playbook_practice_config
.config` JSON blob as top-level `kindOverride`/`severityOverride` siblings of
`enabled`/`config`), resolved through a single widened
`resolvePracticeConfig()` and read by every consumer of "effective kind" —
both engine fire-time call sites, the route serializer, and both client
preview cards — with the resolved value frozen onto each `coach_observations`
row at fire time and never re-derived. Ships alongside a first-class
`defaultSeverity` enum (`info`/`warning`) with a new DB `CHECK`, requiring a
guarded one-time table rebuild of `coach_observations` since SQLite cannot
add a `CHECK` via `ALTER TABLE`.

## Changed files (by layer)

**Backend — data layer**
- `server/db.js` — `coach_observations` `CREATE TABLE` body gains
  `CHECK(severity IN ('info','warning'))`; new guarded rebuild block for
  existing installs, modeled on the file's own `plan_items`/`webhook_targets`
  /`agents` precedent (pre-flight scan for out-of-enum values → skip-don't-
  throw-don't-rewrite if any exist; otherwise rename→recreate→copy→drop,
  reissuing both indexes). No change to `playbook_practice_config`.

**Backend — catalog / resolver**
- `server/lib/playbook/practices.js` — new exported `KIND_VALUES`,
  `SEVERITY_VALUES`, `coerceEnum()`; `resolvePracticeConfig()` return shape
  widens to `{ enabled, config, kindOverride, severityOverride, catalogKind,
  catalogSeverity, kind, severity }`. `PRACTICES` catalog entries and
  `defaultConfigFor()` unchanged.

**Backend — engine (the two fire-time write sites)**
- `server/lib/playbook/engine.js` — `evaluateSession()` and
  `evaluateGlobal()` both stop reading `practice.kind`/
  `practice.defaultSeverity` and instead pass the resolved `kind`/`severity`
  already flowing through `resolveEnabledPractices()`'s spread of the
  resolver's output, into `insertCoachObservation.run(...)`.

**Backend — API**
- `server/routes/playbook.js` — `serializePractice()` gains
  `kindOverride`/`severityOverride`/`resolvedKind`/`resolvedSeverity`, reads
  catalog values from the resolver's `catalogKind`/`catalogSeverity` instead
  of off `practice` directly; new sibling `validateOverridePatch(body)`;
  `PUT` handler threads overrides with `in`-based partial-patch discipline
  (an omitted key must not reset it). `validateConfigPatch()` unchanged.
- `server/openapi-extra/playbook-coach.js` — `PlaybookPractice` schema +
  `required`; `PlaybookConfigPatchRequest`; `CoachObservation.kind`/
  `.severity` descriptions; both hand-written example blocks.

**Frontend**
- `client/src/lib/types.ts` — `PlaybookPractice` gains the four new fields;
  new exported `ObservationKind`/`ObservationSeverity` unions;
  `CoachObservation.severity` narrows `string` → `ObservationSeverity`.
- `client/src/lib/api.ts` — `updatePracticeConfig` patch type gains
  `kindOverride?`/`severityOverride?`; `config` stays numeric-only.
- `client/src/lib/playbookStore.ts` — `save()` patch type mirrors `api.ts`;
  optimistic merge carries the two new fields; new exported client-side
  `resolveKind`/`resolveSeverity` draft-resolution helpers (documented
  duplication, per §9.1's "How to comply," bounded to unsaved draft state
  only).
- `client/src/pages/PlaybookPage.tsx` — new shared `OverrideSelects` control
  wired into both `SessionTokenCeilingCard` and `AccountWeeklyBalanceCard`;
  **lines 257 and 335 fixed** to pass the resolved draft kind instead of the
  bare catalog value; `isDirty`/`onSave`/`onReset` extended in both cards.
- `client/src/i18n/locales/{en,vi,zh,ko}/coach.json` — new `severityLabel`
  block (2 keys) + new `playbook.*` selector-label keys, ×4 locales.
  `kindLabel` reused as-is (already complete in all four).

**Docs**
- `library/knowledge/product/coach/coach-playbook-vocabulary.md` — `kind`
  enum corrected from the stale `opportunity/risk/reinforcement/reminder/
  standard` to `risk/info/good` (dated inline note, DEC-3); new
  `defaultSeverity` enum documented.

**Tests changed in this set**
- `server/__tests__/playbook.test.js` — frozen-snapshot regression (both
  scopes — session and global — both fields, kind and severity) + route-level
  override cases. **This is the load-bearing acceptance test for the whole
  plan.**
- `server/__tests__/db-migration.test.js` — new severity-CHECK rebuild case
  (6 assertions per §6.4 of the technical plan); required deliverable since
  the existing meta-test only scans `ALTER TABLE … ADD COLUMN` and will not
  auto-catch a table rebuild.
- `server/__tests__/playbook-resolver-guard.test.js` — **new file**,
  structural single-resolver guard (3 assertions: server-strict, engine-
  sharpest, client-display-path), modeled on `single-writer-guard.test.js`.
  Must be proven red by injecting a rogue reader (§9.3 VACUOUS-GUARD).
- `client/src/pages/__tests__/PlaybookPage.test.tsx` — selector rendering,
  live-preview wiring before save, save payload.

No tests exist yet for any of the above — this is pre-build. QA's `qa.md`
supporting doc already sketched a near-identical frozen-snapshot test
(§3a), but the technical plan explicitly overrides one detail in it (see
"Plan vs. supporting-doc disagreement" below).

**Config / other:** none.

## Surfaces / features touched

- **Coach Playbook config UI** (`/coach/playbook` — `PlaybookPage.tsx`),
  specifically both existing practice cards: `SessionTokenCeilingCard`
  (session-scoped) and `AccountWeeklyBalanceCard` (global-scoped).
- **Coach engine fire-time write path** (`server/lib/playbook/engine.js`) —
  both scope-specific evaluators, `evaluateSession()` and `evaluateGlobal()`.
- **Coach Playbook REST API** (`GET /api/playbook/practices`,
  `PUT /api/playbook/practices/:id/config`) and its OpenAPI contract.
- **`coach_observations` table schema** (DB-level `CHECK` constraint on
  `severity`, requiring the only DDL in this change).
- **Coach vocabulary documentation** (naming/spec source of truth).

## Variant relevance

Yes — this is precisely the project's #1 recurring bug class
(`PROJECT-CONTEXT.md` §9.1 DERIVED-DUAL-VIEW), already flagged with a live,
dated design-time pre-flag naming this exact intake
(`intake/2026-08-02-practice-kind-override`, "constant becomes a variable"
form). Four independent hand-written readers of "this practice's effective
kind" exist in the current tree and today agree only because the value
cannot vary:

1. `engine.js` `evaluateSession()` (line 97-98)
2. `engine.js` `evaluateGlobal()` (line 145-146)
3. `routes/playbook.js` `serializePractice()`
4. `PlaybookPage.tsx` — two preview lines, one per card (257, 335)

This feature makes the value vary for the first time. The plan's countermeasure
(single resolver + structural rogue-reader guard, proven red by injection) is
the correct shape and is the thing to verify was actually built, not merely
described. There is also a second §9.1 "helper duplication" instance already
live on this exact surface (`resolvePracticeConfig()`'s numeric-field-merge
rule vs. `validateConfigPatch()`'s copy of the same rule) — the plan's
Override 1 keeps these as two functions sharing one exported enum/helper
rather than one extraction, which is a smaller cure than PM's D2 asked for
("stop having two copies" via full extraction); worth flagging to the build
reviewer as a scope note, not a blocker.

## Test-invariants at risk

- [ ] **Frozen-snapshot invariant (this build's core, named invariant)** —
  an Observation's `kind`/`severity`, once written to `coach_observations`,
  must never retroactively change after a later override change. Directly
  named in `technical-plan.md` §2.4, `decisions.md` DEC-1/PM's D3, and
  `PROJECT-CONTEXT.md` §9.1's "Inverse-application warning" for this surface.
  The acceptance test is explicitly the **inverse** of §9.1's usual "same
  value across every consumer" bar — a test asserting live-resolved-kind ==
  stored-Observation-kind would demand the *wrong* behavior here. Verify:
  (a) the frozen-snapshot regression test exists for **both** scopes
  (`account-weekly-balance` global, `session-token-ceiling` session — not
  just one), (b) it asserts `severity` alongside `kind` at every step (severity
  is otherwise unverifiable — `ObservationCard.tsx` never renders it, per
  WATCH-2), (c) it is shown **red** against pre-change code before counting
  (§9.3 VACUOUS-GUARD), and (d) `updateCoachObservationStatus` still touches
  only `status`/`responded_at`, never `kind`/`severity`.
- [ ] **Both engine call sites move together (§9.4 FIX-ROUND-REGRESSION
  shape)** — `evaluateSession()` and `evaluateGlobal()` are two independent
  call sites into `insertCoachObservation.run(...)`; a fix landing on one and
  not the other is exactly this project's named recurring failure shape
  (§9.4, cited directly in the technical plan §Step 4). Verify:
  `grep -n "practice\.kind\|practice\.defaultSeverity" server/lib/playbook/
  engine.js` returns nothing after the build, and both scopes have a
  dedicated frozen-snapshot test (a green global-scope test proves nothing
  about the session-scope call site).
- [ ] **Single-resolver structural guard, proven non-vacuous (§9.1 + §9.3)** —
  `playbook-resolver-guard.test.js` must exist, assert `practice.kind`/
  `practice.defaultSeverity` appear nowhere outside `practices.js` in
  `server/` (excluding `__tests__`), nowhere in `engine.js` specifically
  (separate, sharper assertion), and nowhere outside `types.ts` in
  `client/src`. Per §9.3 VACUOUS-GUARD, this must be shown to go **red** by
  injecting a rogue reader into both `engine.js` and a client card before it
  counts as proven — record that this was done in the PR/commit message.
- [ ] **FRESH-DB-BLIND SCHEMA CHANGE (§9.5), applied to a `CHECK` a normal
  `ALTER TABLE ADD COLUMN` migration can't express** — the severity `CHECK`
  added only to the `CREATE TABLE IF NOT EXISTS` body would no-op on every
  existing install (SQLite can't add a `CHECK` via `ALTER TABLE`). Verify the
  guarded one-time rebuild is idempotent (second boot = no-op via
  `sqlite_master.sql`-text guard), preserves every row's values and `id`s
  byte-for-byte, recreates both indexes, and the pre-flight-skip path
  (WATCH-3: an install with an out-of-enum severity value already present)
  neither throws (would brick the app at boot — `db.js` runs at `require`
  time) nor rewrites the offending rows (would itself violate the frozen-
  snapshot invariant above). Verify `db-migration.test.js`'s meta-test (which
  only scans `ALTER TABLE … ADD COLUMN`) does **not** silently treat this
  rebuild as already covered — it isn't, by the meta-test's own scan shape,
  which is exactly why the plan calls the migration test a required
  deliverable rather than a tripwire.
- [ ] **Two-independent-validators hazard (opposite silent-failure
  directions)** — `resolvePracticeConfig()` (resolver, must never throw —
  called outside `tick()`'s per-scope try/catch, must fail safe to catalog
  default on garbage) and the route's new `validateOverridePatch()` (must be
  loud — a rejected PUT is recoverable, a silently-dropped one is not) are
  two separate functions sharing only an exported enum + `coerceEnum` helper,
  not one extraction. Miss the route validator → PUT 400s or accepts garbage;
  miss the resolver → PUT 200s and persists, but every read path ignores it
  forever ("saved but never applied," passes a shallow smoke test). Verify a
  route test proves the "saved but never applied" direction specifically
  (PUT succeeds, follow-up GET shows `resolvedKind` actually changed), not
  just that invalid values 400.
- [ ] **Numeric-field save must not clear an existing override (partial-
  patch discipline)** — `PUT { config: { gapThresholdPct: 30 } }` on a
  practice that already has a kind override must leave the override intact.
  This requires `in`-based (not `=== undefined`-based) key presence checks so
  an explicit `null` (clear) is distinguishable from an omitted key
  (unchanged) — get this wrong and every ordinary numeric-threshold save
  silently eats the operator's kind override.
- [ ] **Live-preview wiring (client-only, no server test can see it)** —
  `PlaybookPage.tsx` lines 257 and 335 currently pass the bare catalog
  `practice.kind` into each card's live-preview `<ObservationCard>`. If not
  fixed to the resolved draft value, an operator can select "Warning," save
  successfully (200 OK), and the preview directly underneath the control
  still reads "Reminder" — a visibly broken feature invisible to any route-
  or engine-level test. Verify a client test explicitly exercises the
  preview updating **before** save (draft-time), not just the save payload.
- [ ] **i18n completeness for new strings** — `severityLabel.info`/
  `severityLabel.warning` and the new `playbook.*` selector-chrome keys must
  be present in **all four** locales (en/vi/zh/ko); an absent key renders the
  raw key string to the user. `kindLabel` itself needs no change (already
  confirmed complete in all four locales, this pass).
- [ ] **No re-sync mechanism added** — explicitly forbidden by the plan and
  by §9.1's inverse-application note: no trigger, computed column, view, or
  backfill that "re-syncs" a historical Observation's `kind`/`severity` to a
  changed override. A reviewer citing §9.1's usual criterion here without
  checking which pair (live-resolved vs. frozen-historical) they mean would
  be demanding the wrong fix.

## Stated intent / acceptance

Verbatim from `decisions.md` / `pm-plan.md`, echoed in the technical plan's
own DoD (§8):

- The override must be read **at fire time** and frozen onto the
  `coach_observations` row; changing the override later must never
  retroactively relabel an already-created Observation (Sara's own stated
  hard constraint, per `pm-plan.md`'s Request summary).
- All three `kind` values are freely selectable, including "downgrades" —
  no ordering to enforce (DEC-4).
- The mechanism must be generic across every practice, present and future,
  with zero per-practice catalog edits (DEC-2).
- Setting an override must survive reload and propagate live to every
  connected client via the existing `playbook_practice_config_updated`
  broadcast (product-owner.md, acceptance criterion #2).
- `severity` is being shipped fully functional at the data layer with **no
  visible effect anywhere in the product yet** (`ObservationCard.tsx` never
  renders it) — a knowingly-shipped limitation, tracked as WATCH-2, not a
  build defect if severity has no visual manifestation post-merge.
- Full `npm test` (server + client) green before and after; a DB backup must
  be taken before the first boot of the new build, since the `coach_
  observations` rebuild is the only step in this plan that rewrites a table.

## Plan vs. supporting-doc disagreement (flagging per triage instructions)

`supporting/qa.md` §3a's worked test snippet uses `JSON.stringify({
gapThresholdPct: 25, kind: "risk" })` — a nested `config.kind` key. The
technical plan's Override 1 explicitly supersedes this: the persisted key is
**`kindOverride`** (a sibling wire field, not nested in `config`; storage
stays inside the same JSON blob under that key name), and `technical-
plan.md` §2.2 flags this exact mismatch as "Override 3 — QA's test snippet
uses the wrong config key," instructing builders not to copy it verbatim.
This is a plan-supersedes-supporting-doc case, not an unresolved
disagreement — the technical plan is dated after and explicitly overrides
the supporting QA doc on this one point, and everything else about QA's
five-step shape is adopted unchanged per the plan's own text.

## Open questions

**Blocking (cannot plan tests):**
- none.

**Non-blocking (proceeding on assumption):**
- DEC-5 (adopt an un-intake'd-capability routing rule in this repo's
  `PROJECT-CONTEXT.md`) is still PENDING and explicitly does not block this
  build per both `decisions.md` and `pm-plan.md` → assumption: test planning
  proceeds without waiting on DEC-5; it's a process-governance item orthogonal
  to this feature's correctness.
- The severity override's UI selector has no visible product effect
  (WATCH-2, accepted knowingly) → assumption: test coverage for severity is
  data-layer-only (frozen-snapshot assertions), with no visual/UI assertion
  expected or required for severity specifically.
- WATCH-3 (the migration silently skips, leaving the DB-level CHECK absent,
  on any install already holding an out-of-enum severity value) is accepted
  as a real, disclosed, narrow divergence → assumption: test coverage proves
  the skip-not-throw-not-rewrite behavior (already in the plan's §6.4 item 6)
  but does not need to prove universal CHECK presence across all possible
  install histories.

## Verdict

**READY**
