# Green-Evidence Log — build/2026-08-05-altitude-invalidation (Final verifier pass, after fix cycle 2)

**Verifier discipline applied:** every claim below is from direct re-execution in
the effort worktree
(`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-04-altitude-invalidation/Claude-Code-Agent-Monitor`,
branch `effort/2026-08-04-altitude-invalidation`), not from reading any prior
agent's report. This supersedes the fix-cycle-1 verdict recorded earlier in this
same file (see decisions.md DEC-B4/DEC-B5 for that history) — that content is no
longer current and has been replaced by this pass.

**Verdict: GREEN-WITH-CAVEATS.** All 6 review blockers (BL-1..BL-6) are
genuinely fixed and independently red-proven by me (not trusted from any
report). Full suites are green. The one caveat: 7 of 11 should-fix findings
(SF-1, SF-3, SF-4, SF-5, SF-7, SF-9, SF-11) were left unfixed **and their
disposition was never recorded anywhere** — no `decisions.md` row, no WATCH
row, no code comment — which is a literal, named, unmet line in
`technical-plan.md`'s own Definition of Done ("Final": *"Any scope declined
during the build that is not already OPEN-1..OPEN-4 or WATCH-A..WATCH-G has
its own row added before the build closes"*), and is this exact project's own
catalogued §9.4 FIX-ROUND-REGRESSION failure mode ("'should-fix' is a triage
label, not a disposition" — the same catalog entry records that this omission
previously hid a real silent data-loss bug in another effort). See §4 below.

---

## 1. Full suite tallies (own execution, this pass)

### Server (`npm run test:server`, scratch `DASHBOARD_DB_PATH`)

```
# tests 1711
# suites 424
# pass 1711
# fail 0
```

### Client (`npm run test:client`)

```
Test Files  61 passed (61)
     Tests  810 passed (810)
```

### Build / typecheck

- `npm run build` (client, vite) — succeeds, no errors (only a pre-existing
  chunk-size advisory warning, unrelated to this change).
- `node -e "require('./server/db.js')"` — boots cleanly, no throw.

### Standing guards (own execution)

- `bash .claude/skills/file-headers/scripts/check-headers.sh` → exit 0.
- `chronology-ordering.test.js` → 4/4 (bundled run) — no new grandfathering.
- `openapi-contract.test.js` → 4/4.
- `ledger-metrics-parity.test.js` → included in the above bundle, green.
- `single-writer-guard.test.js` → 13/13, including the two BL-5-relevant
  cases (`buildPrompt reads no unit field outside unitFacts(u)…` and
  `A2-HOME`), and the widened `insertValueSummaryGeneration`
  (two call sites) / `markValueUnitSummariesSeen` (one call site) /
  `upsertValueUnitSummary.run(` (one call site) guards from the DoD's
  "Guards" section — all pass.

### Known, pre-existing, out-of-scope flake (not a regression)

`value-summary-tick.test.js`, `S1 should-fix (sweep rotation advances even on
bookkeeping failure)` fails intermittently (~50% of runs, confirmed over 4
repeated runs of that file alone) with `notStrictEqual` on two identical
millisecond-resolution ISO timestamps. This is the exact mechanism
`decisions.md` DEC-B2 already logged and explicitly ruled out of this build's
scope ("intermittently fails on a millisecond-resolution timestamp
collision... unrelated to any file this build touches... left for a future
pass"), and matches review-findings.md's N-6. Full-suite runs (`npm run
test:server`, above) came back 1711/1711 both times I ran them, i.e. the
flake did not trigger in either full run. Not counted against this build.

---

## 2. The 6 review blockers (BL-1..BL-6) — independently confirmed fixed, not trusted from any report

| # | Claim | How I verified (not self-report) |
|---|---|---|
| BL-1 | `enrichPoolAltitudes`'s empty/all-dropped early return now carries `counts` | Read `server/lib/value-summary.js:376-389` directly — `counts` is now computed before the early return and included in it. **Reverted the fix** (removed `counts` from the early-return object) and re-ran `value-summary.test.js`: 2 tests went red (`enrichPoolAltitudes caching`, `POST /api/project-plans/altitudes`) with a `TypeError`-class failure matching BL-1's mechanism. Restored the file (`diff` confirmed byte-identical to before the injection); full suite green again. |
| BL-2 | `pool_size` and every counted term now derive from the same deduped list | Read the fix (`dedupedUnits = [...new Map(units.map(u => [u.unitKey, u])).values()]`, `counts.pool_size = dedupedUnits.length + droppedCount`). **Reverted** to the raw-list form and re-ran: `COUNTS-DUPLICATE-KEY (BL-2)` and `ROUTE-SEAM-1b (BL-2)` both went red with the exact identity-mismatch this blocker names. Restored; suite green again. |
| BL-3 | All nine new `UPGRADE_CASES` entries now actually execute (legacy DB seeded, `assertLegacyRow`/`assertWritable` called for real) | Read `db-migration.test.js`'s `M1`/`M2`/outcome-model-duration_ms `describe` blocks: each now seeds a genuinely legacy DB via `upgradeCase.legacySql`/`seed` in `before()`, then calls `upgradeCase.assertLegacyRow(db)`/`assertWritable(db)` inside the `it`. The `assertWritable` arity bug (8 args into an 11-placeholder statement) is fixed — confirmed `insertValueSummaryGeneration`'s prepared statement (`db.js:3425-3428`) has 11 placeholders and the test calls now pass exactly 11 args. Ran `db-migration.test.js` directly: all pass, including `M1`, `M1 it4`, `M1-INT`, `M2`, and the `outcome`/`model`/`duration_ms` legacy-shape case. |
| BL-4 | `MIG-HELPER-1..4` now assert real behavior | Read all four `it`s (`db-migration.test.js:2160-2251`): non-existent table → `false`/no-throw; a genuine SQLite ALTER rejection (`INTEGER PRIMARY KEY`) → caught, logged, `false`, all-or-nothing rollback verified via `PRAGMA table_info`, then a follow-up call proves recovery; idempotency (`true` then `false`, one column, not two); partial-state convergence (2 of 3 missing columns added, pre-existing column untouched). Cross-checked against `addColumnsIfMissing`'s actual implementation (`db.js:1752-1776`) — matches the tested contract exactly. Ran directly: 4/4 pass. |
| BL-5 | The A2 scan now covers the whole `buildPrompt` body (not just the `.map` callback) and adds assertion (i) for the array-parameter mention | Per the task brief, the orchestrator already independently confirmed this by literal mutation-injection (`units[0].stage` sneak read) and watched it fail then pass. I additionally read the 9-assertion scan (`single-writer-guard.test.js:405-595`) and re-ran it: green, and it is present in the 13/13 `single-writer-guard.test.js` run above. |
| BL-6 | `unitFacts`/`compareUnitInputs` field-coverage gap now has an enumerated-exception registry (`UNCOMPARED_FIELD_GUARANTORS`) and a walking coverage test | Read `value-summary.js:157-208` (the registry + its justifying comment: `value_source` is safe because `unit_key` embeds it, a different invariant, asserted by a companion test) and `value-summary.test.js:945-1023` (walks `Object.keys(unitFacts(fixture))`, mutates each, asserts detection, asserts the excepted set is exactly `["value_source"]`). **Injected a new uncovered field** (`sneaky_new_field`) into `unitFacts`'s return shape without adding a comparator branch or a registry entry: the BL-6 coverage test went red with exactly the message it's designed to produce. Restored (diff confirmed clean); suite green again. |

All six: genuinely fixed, genuinely tested, genuinely red-proven by direct
injection (not by reading a report).

---

## 3. Should-fix items applied in fix cycle 2 — confirmed real

| # | Claim | Verified |
|---|---|---|
| SF-2 | Dismiss "×" no longer renders on `stale_refresh_queued`/`stale_refresh_unavailable` rows | `PlanLedgerPanel.tsx:491-522`: the button is now gated on `resolved.freshness === "updated_unseen"` only. `PlanLedgerPanel.test.tsx`'s `C1b` test (lines 683-715) asserts, per row, that the two stale-refresh rows have **no** dismiss button and the `updated_unseen` row does. |
| SF-6 | Both the route's audit-log write and the `/altitudes/seen` ack transaction are now guarded | `project-plans.js:188-204`: audit-log write wrapped in try/catch, logs a warning, response still succeeds (correct — it's a log, not the result). `project-plans.js:264-277`: the ack transaction is wrapped, and a failure now returns `500` rather than a false "success" (correct — this write **is** the result). |
| SF-8 | DEC-19's CONTRACT-SPEC-DRIFT scope-limit note applied verbatim | `PROJECT-CONTEXT.md:1403-1409` — present, matches the verbatim text from `qa/qa-assessment.md`'s "Catalog notes" section (`optional... if the build declines the fragment`) word-for-word, dated, count-unchanged. |

---

## 4. CAVEAT — should-fix items left unfixed have no disposition record anywhere

Confirmed by direct code/doc inspection (not inferred) that none of the
following 7 review findings were fixed, **and none has any disposition
record** (no `decisions.md` row/id, no `WATCH` row, no code comment marking
them as known/deferred/accepted):

- **SF-1** — `dismissAll` i18n key still exists in all four locales, still
  referenced nowhere in `client/src/` (`grep -rn "dismissAll" client/src/`
  matches only the four locale JSON files).
- **SF-3** — `ALTER-BLOCK-SCAN`'s comment is unchanged; the two multi-ALTER
  blocks behind a single probe (`agents.workflow_run_id`,
  `context_snapshots.input_tokens`) are still outside its reach, undated,
  ungrandfathered.
- **SF-4** — the migrated `outcome`/`source` columns on
  `value_summary_generation_log` still carry no `CHECK`, diverging from the
  fresh-`CREATE TABLE` shape; no `docs/DATABASE.md` note, no WATCH row.
- **SF-5** — `db.stmts = stmts;` (`db.js:3435`) is still present, still
  unused by any production code (only by tests that pass the raw handle).
- **SF-7** — `value-summary-tick.test.js`'s `L4` (lines 970-991) is
  unchanged: still `assert.ok(x >= 0)` ×4 plus the identity, still provably
  satisfiable by the pre-Slice-1 tick's old counting behavior, still using a
  default `trunk_commit` fixture that never exercises `stale_regenerated`.
  This is the exact test DEC-B1 flagged for build-reviewer to "scrutinize
  once the tick's counting-loop replacement lands" — it was scrutinized
  (review-findings.md SF-7) but the outcome (still vacuous) was never acted
  on or logged.
- **SF-9** — `readCached` (value-summary.js:222-231) still discards the row
  it read on a stale hit; `enrichPoolAltitudes` (line 436) still re-queries
  `getValueUnitSummary.get` a second time for the same key.
- **SF-11** — `project-plans.js:198`'s `insertValueSummaryGeneration.run(...)`
  still passes a literal `null` for `model`, even when the request path just
  generated text with a real model.

**Why this gates a caveat, not a pass:** `technical-plan.md`'s own DoD
("Final" section) states: *"Any scope declined during the build that is not
already OPEN-1..OPEN-4 or WATCH-A..WATCH-G has its own row added before the
build closes."* `decisions.md` DEC-B6 itself set the same bar for this exact
round: should-fix items get *"fixed if the implementer confirms them real and
low-risk, otherwise logged as follow-up debt, not silently dropped."*
Neither happened for these 7. This project's own catalog (`PROJECT-CONTEXT.md`
§9.4 FIX-ROUND-REGRESSION) names this precise failure mode by id
("'should-fix' is a triage label, not a disposition") and records that the
same omission, in a prior effort, silently dropped a real data-loss bug
(S9) among the unlogged remainder. None of the 7 items above look like S9 on
read (all are either UX gaps, scan-scope limits, minor doc drift, or vacuous
tests — not silent data corruption), but the catalog's own point is that
severity-on-read is provisional until someone checks, and here nobody
checked and nobody logged the choice not to.

**What closes this caveat:** a `decisions.md` entry (or per-item WATCH rows)
recording, for each of SF-1/3/4/5/7/9/11, either a fix-it-now decision or an
explicit accepted-as-follow-up-debt disposition with a dated id. This is a
paperwork/discipline fix, not a code fix — nothing above requires touching
the diff that's already green.

---

## 5. Definition of Done — walked line by line (technical-plan.md §8 + test-plan.md DoD)

**Environment & artifacts**
- [x] Effort branch in an isolated worktree, own branch (`effort/2026-08-04-altitude-invalidation`).
- [x] `DASHBOARD_DB_PATH` scoped per test invocation (confirmed by grep pattern in every migration `describe`).
- [~] `decisions.md` — present with DEC-B1..DEC-B6/DEC-B2, but **not yet updated with a fix-cycle-2 disposition entry** for the caveat in §4 above.

**The durable cure (MANDATORY — never traded away)**
- [x] `buildPrompt` reads only through `unitFacts()` — 9-assertion structural scan, whole-function-body scope (BL-5 fix), red-proven by the orchestrator's own mutation injection.
- [x] One shared `unitFacts`/`compareUnitInputs`; `counts` computed once by the composer, read verbatim by both loggers (confirmed: tick's `generatedKeys.length === counts.generated`, no re-derivation).
- [x] BL-6's enumerated-exception coverage test closes the comparator-gap risk this cure's own header comment claims to close.

**Behavior**
- [x] D1–D6/D5b, A1–A3, DEC-7 parity, R3, Case 5/6, L1–L4 (L4 vacuous per SF-7, see caveat, but not a regression — it was already flagged and the underlying behavior it should test is covered elsewhere: `D6b`, `DEC-11-ANTIFIX`, `COUNTS-SHAPE`), `ALTITUDE_STATES`/`MUTABLE_VALUE_SOURCES`/`trunk_commit` unchanged-behavior — all green in this run.

**Schema**
- [x] M1/M2 `UPGRADE_CASES` — now genuinely executed against a seeded legacy DB (BL-3 fix), idempotent, plus the M1 it4 behavioral leg. No new `GRANDFATHERED` entries.
- [x] `chronology-ordering.test.js` green, no new grandfathering.

**Guards**
- [x] `insertValueSummaryGeneration` — 2 call sites (tick + request), guard test green.
- [x] `markValueUnitSummariesSeen` — 1 call site, guard test green.
- [x] `upsertValueUnitSummary.run(` — 1 call site.
- [x] `assertSingleHome` updated for both new exports.

**Client**
- [x] C1–C3 green, structural (not vacuous) per-row queries; i18n keys, not hardcoded text; explicit acknowledge only (C2).
- [x] All four locales carry the new keys; i18n registry test green.
- [x] Screen-snapshot suite green (19/19), part of the 810/810 client total.

**Docs & catalog**
- [x] `value-summary.js` header + `db.js` schema comments rewritten.
- [x] Both DEC-10 `PROJECT-CONTEXT.md` catalog notes applied on-branch (§9.5, §9.1/§9.8) — confirmed present.
- [x] SF-8's DEC-19 CONTRACT-SPEC-DRIFT note also applied (fix-cycle-2 addition, confirmed §3 above).
- [x] `docs/API.md`, `docs/DATABASE.md`, `server/README.md`, `ARCHITECTURE.md` all updated.
- [x] `check-headers.sh` exits 0.

**Final**
- [x] `npm run test:server` / `npm run test:client` fully green (own execution, this pass).
- [x] No zero-assertion test bodies found in the files this build touches (spot-checked the previously-flagged `MIG-HELPER`/`UPGRADE_CASES` sites specifically, since those were the named prior offenders — both now have real assertions).
- [ ] **Not verified this pass:** the manual Resume walkthrough in real Chrome (out of scope for this verification pass; no evidence either way was presented to me).
- [ ] **Unmet:** "any scope declined during the build... has its own row added before the build closes" — see §4 caveat.

---

## 6. Git state

`git log c8eecf3..HEAD` is still empty; the worktree is still fully uncommitted
(23 modified + 2 untracked test files + untracked root-level `supporting/`).
This is expected under this skill's stop-at-green-and-report contract — **not**
a defect of this pass. Per `~/.claude/skills/team-build/SKILL.md`, this
build's outer invocation is `fast`, which implies `auto-pilot` behavior for
the ship gate specifically: once a build reaches GREEN, Step 8 commits + pushes
on the effort's own branch automatically (never onto the shared default
branch, never force-pushed). That decision belongs to Step 8 of the calling
skill / the orchestrator, not to this verifier pass — no commit was made here.
