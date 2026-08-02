# Code review — build-project-manager (layers 4–6)

Reviewed: full working-tree diff against `3c2db7d` in
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor`
(nothing committed yet — 17 modified tracked files + 12 new untracked files).
Suite re-run here: **1189/1189 pass**, `check-headers.sh` exits 0.

Every finding below was reproduced by executing the shipped code, not by reading
alone; the reproduction is quoted inline.

---

## Blockers

### B1 — A pace breach is silently dropped from the decision queue whenever the same tick also flags a detour
`server/lib/reconciliation.js:307–325`

The `pace_alert` enqueue lives **inside** `if (rules.flaggedDetours.length === 0)`.
But a pace breach is itself what sets `cwdEscalated` (`reconciliation.js:143`),
which flags every pending detour for that cwd (`:150`). So in the most common
real shape — a project that is behind *and* has a pending detour — R1's alert is
computed, used to escalate, and then never written anywhere. The digest-gate
early return at `:336–338` drops it a second way.

Reproduced (1 overdue item + 1 old pending detour):

```
paceBreaches: 1 flaggedDetours: 1
queue rows after tick: [{ kind: "detour_disposition", ... }]
pace_alert present: false
```

`technical-plan.md` §4 step 23(d) requires "R1/R2 flags → `pace_alert` /
`detour_volume` queue rows" unconditionally. No test in the suite asserts a
`pace_alert` row is ever produced (`grep -rn pace_alert server/__tests__` hits
only chronology fixtures), which is why this is green.

**Fix:** hoist the pace-breach enqueue loop out of the `flaggedDetours.length === 0`
branch (and above the digest-gate return) so it runs on every tick for the cwd.

### B2 — R2 (detour volume) computes a verdict and throws it away
`server/lib/reconciliation.js:124–136, 160`

`detourVolumeTripped` is only ever used to set `cwdEscalated`. There is no
`kind: "detour_volume"` insert anywhere in the tree
(`grep -rn detour_volume server` → only the CHECK constraint in `db.js:726` and
two doc lines). Layer 6's second rule therefore produces nothing Sara can see,
and the `detour_volume` enum value is unreachable. Same plan clause as B1; zero
test coverage.

**Fix:** enqueue a `detour_volume` row via `enqueueIfNotOpen` when
`rules.detourVolume.tripped`, with `payload` = `{ratio, totalClassified, detourCount}`,
alongside the (hoisted) pace-alert loop.

### B3 — An LLM verdict with no `proposed_text` writes a junk empty checkbox into AGENT-PLAN.md, unattended, and reports success
`server/lib/plan-writeback.js:300–316` (and `:345`), `server/lib/reconciliation.js:371–383`

`parseDispositionOutput` sets `proposed_text: null` whenever the model omits the
field (`reconciliation.js:221`) — entirely plausible for a `new_item` verdict —
and nothing between there and the file write rejects it.
`sanitizeLlmPlanText` degrades a non-string to `""` by contract
(`plan-writeback.js:64`), and `composeItemBlock` happily emits `- [ ] 2. `.

Reproduced (disposition `new_item`, `proposed_text = null`):

```
write_status: written
file now: "# Plan\n\n- [ ] 1. Existing\n      id: e1\n- [ ] 2. \n      id: ec2f4bbe\n"
plan_items rows: 1:"Existing"
```

Two harms: (a) Sara's stakeholder-facing document gains a blank item from an
unattended write — the exact scenario DEC-13 calls "the only guard between an
unattended LLM classification and Sara's plan file"; (b) the parser refuses to
re-ingest the empty item, so the row is marked `write_status='written'` with a
`resolved_item_id` that has **no** `plan_items` row — the audit trail lies, and
DB and file now disagree.

This is the catalogued "guard that looks complete but is silent on the dimension
that matters": the sanitizer covers newline/prefix injection and length, and says
nothing about empty.

**Fix:** in `applyDisposition`, before dispatching, sanitize `proposed_text` and
bail with a structured failure (`write_status='failed'`,
`write_error='EMPTY_PROPOSED_TEXT'`, `writeback_failed` queue row) when the
sanitized text is empty. Add the case to `plan-writeback.test.js`.

### B4 — The single CONFLICT retry can never succeed in the production configuration; the test that "proves" it only passes because its fixture is a state neither call site produces
`server/lib/plan-writeback.js:431–454`, `server/__tests__/plan-writeback.test.js:301–355`

`baselineHash` is computed **once** (`:445`) and both attempts are checked against
that same fixed reference (`appendToPlanFile:194, 248`). If attempt 1 returned
`CONFLICT`, the file on disk is by definition no longer `baselineHash`, so
attempt 2's re-check compares the (new) disk hash against the (old) fixed
baseline and returns `CONFLICT` again. The only way it can succeed is if the
file reverts to exactly the baseline bytes between the two attempts.

Reproduced in the production shape (plan ingested, so `plans.content_hash` is
non-null → `freshHash()` returns it):

```
plans.content_hash present: true
attempts: 2
write_status: conflict  write_error: CONFLICT
backup files left behind by a failed write: 2
```

The suite is green because `plan-writeback.test.js:301` asserts only
`attemptCount === 2` ("should have retried and eventually **succeeded or
conflicted**") and its fixture cwd was never ingested, so `freshHash()` returns
`null` → each attempt re-baselines against its own read. Neither real call site
can produce that state: `listReconcileTargets` selects only cwds that have a
`plans` row, and the route path passes the caller's `expected_hash`.

Docs assert the opposite of the code and must be corrected with it:
`ARCHITECTURE.md:382` ("retries exactly once on `CONFLICT` **with no reused
hash**"), `server/README.md:655` ("retry once on conflict"),
`server/routes/decision-queue.js:4–5` ("a **fresh** optimistic check — never a
stale expected_hash").

**Fix:** the retry must re-baseline against the file's *current* hash (that is
what "retry" means, and it is still safe — the re-check then proves nothing
changed during the retry's own window, which is WATCH-9's accepted bound).
Concretely: on `CONFLICT`, call `attempt(null, true)` so `appendToPlanFile`
derives the baseline from its own fresh read. Then strengthen the test to assert
`write_status === 'written'` and that the human's concurrent line is still in the
file — the current assertion cannot tell a working retry from a broken one.

### B5 — DEC-14(2) not delivered: a `writeback_conflict` row cannot show Sara what we tried to add
`server/lib/plan-writeback.js:479–491`

DEC-14 point 2 keeps `suggested_markdown` specifically so that "a
`writeback_conflict` queue entry can show Sara what we tried to add". On the
failure path `markDetourWriteResult` is called with `null` for
`suggested_markdown` (arg 5), and `appendToPlanFile` discards the composed
`markdown` on every `{ok:false}` return, so the attempted block is lost. The
queue row's `payload` carries only `{code, error}`.

Reproduced: `suggested_markdown on failure: null`.

**Fix:** return `markdown` on the structured failure returns from
`appendToPlanFile`/`buildCandidate` and persist it in the conflict/failed branch
(and mirror it into the queue row's payload). Assert it in
`reconciliation-full-tick.test.js` Scenario B.

### B6 — MANDATORY Task 27 (§9.2 durable cure) is partly nominal
`server/__tests__/chronology-ordering.test.js:17, 143–172, 285–333`,
`server/__tests__/helpers/ordering.js`

Three separate shortfalls in the one task the catalog itself mandated:

1. `assertOrderedByCreatedAt` is **imported and never called** — all five
   behavioral cases hand-roll their own scramble+assert. The helper exists as a
   file and is dead code, so the "adding the regression test costs less than
   skipping it" cure (PROJECT-CONTEXT §9.2) is not actually in place.
2. The case named **"Layer 6 detour-volume lookback selects the created_at-ordered
   window"** — named by the catalog as the *worst* unguarded query — actually
   calls `stmts.listPendingDetours` (`:165`), duplicating case 4. The real
   lookback (`reconciliation.js:127–132`, over `focus_inferences.inferred_at`) is
   never exercised with a scrambled fixture. (The query itself *is* compliant —
   it filters by `inferred_at` and has no LIMIT — so this is a coverage/labeling
   defect, not a live bug, but the file currently claims coverage it does not
   have.)
3. `"backfillDeclaredDetours respects created_at ordering"` (`:285`) is
   tautological: it asserts that rows returned by its own
   `... ORDER BY created_at ASC` re-query are in `created_at` order. Deleting the
   `ORDER BY` from `detours.backfillDeclaredDetours` cannot make it fail.

**Fix:** route the five cases through `assertOrderedByCreatedAt`; point the
detour-volume case at `evaluateRules(...).detourVolume` with `focus_inferences`
rows seeded out of order (ids ascending, `inferred_at` descending, some outside
the lookback) and assert the ratio/count; assert `backfillDeclaredDetours` by the
`id`-ordered insertion sequence of the rows it creates, not by a re-query that
sorts them.

---

## Should-fix

### S1 — The write-back's anti-duplicate queue guard never matches when the disposition carries an `item_id`
`server/lib/plan-writeback.js:493–510`

`findOpenQueueItem.get(kind, dispositionId, null)` probes with `item_id IS NULL`,
but the insert three lines below stores `row.item_id || null`. Any disposition
linked to a plan item therefore never matches its own open row.

Reproduced: three `applyDisposition` calls on one disposition with
`item_id='item-abc'` → **3** `writeback_failed` rows (expected 1).

Bounded today (the tick does not re-attempt a `conflict`/`failed` row), but every
`ccam decisions retry` adds another duplicate. Note this block hand-rolls the
same find-then-insert sequence `reconciliation.enqueueIfNotOpen` already
implements correctly (`reconciliation.js:273–288`) — §9.1 DERIVED-DUAL-VIEW one
layer over, and the copy is the one that's wrong. **Fix:** extract
`enqueueIfNotOpen` to a shared module (or export it) and call it from both.

### S2 — `withCwdLock` is a no-op whose comment promises a guarantee it does not provide
`server/lib/plan-writeback.js:150–169`

The map is written and deleted, never read or awaited. It provides zero mutual
exclusion; the comment says it "exists so a future async caller (e.g. a batched
multi-append) gets the same guarantee", which is false — a future async caller
gets nothing. WATCH-10 in `decisions.md` also describes it as a
`Map<cwd, Promise>` mutex. Correct for today's synchronous callers, actively
misleading for the next contributor. **Fix:** either implement the promise-chain
mutex WATCH-10 describes, or delete the map and state plainly that mutual
exclusion rests on the calls being fully synchronous — and correct WATCH-10.

### S3 — A sub-item append silently rewrites a CRLF plan file to LF, whole-file
`server/lib/plan-writeback.js:214, 359–364`

`rawBefore.split(LINE_SPLIT_RE)` then `newLines.join("\n")` normalizes every line
ending in the document. Reproduced: a 4-line CRLF plan file came back with
`CRLF count after write: 0 (was 4)`. An unattended "append one item" that
rewrites every line of Sara's file is well outside the blast radius DEC-2/DEC-13
approved (and would show as a whole-file diff in her git). `appendPlanItem`
(`:314`) has the sibling half of the bug: it appends LF lines to a CRLF file,
producing mixed endings. **Fix:** detect the dominant EOL from `rawBefore` once
in `appendToPlanFile` and have both composers join with it.

### S4 — `appendPlanItem` re-reads the file a second time inside `buildCandidate`
`server/lib/plan-writeback.js:313`

`appendToPlanFile` already read and hashed the file (`:186`) and hands the split
lines to `buildCandidate`; `appendPlanItem` ignores them and issues its own
`fs.readFileSync`. Two consequences: the composed bytes and the parsed model can
come from different reads, and a file deleted between the two reads throws out of
a function documented "Never throws" (`:177`) — straight through
`applyDisposition` into the route handler. `appendSubItem` does not do this.
**Fix:** pass `rawBefore` into `buildCandidate` and use it.

### S5 — Every conflict leaves an orphan backup of a file that was never modified
`server/lib/plan-writeback.js:226` (backup) vs `:240–250` (the re-check)

`writeBackup` runs before the optimistic re-check, so both failed attempts of a
conflicting write leave a `.bak.md` (reproduced: 2 backups, file unchanged).
Under WATCH-8 (no retention policy) these accumulate for writes that never
happened. **Fix:** unlink the backup on the `CONFLICT`/failure returns, or move
the backup to immediately before `atomicWriteFile` and note the (tiny) widening
of the WATCH-9 window.

### S6 — `detour_dispositions` has no `project_id` column
`server/lib/plan-writeback.js:501`

`row.project_id` is always `undefined`, so writeback queue rows always land with
`project_id = NULL` (the reconciliation path passes a real one). Either look the
project up via `getProjectPathByCwd` like `listReconcileTargets` does, or drop
the expression and the implication that it works.

### S7 — `retry_write`'s "fresh optimistic check" is not fresh
`server/routes/decision-queue.js:58–66` + `plan-writeback.js:431–434`

With no `expectedHash` in `opts`, the baseline falls back to
`plans.content_hash` — precisely the stale value after the human edit that caused
the conflict, until the background poll re-ingests. So the documented recovery
path (`ccam decisions retry <id>`, cited in WATCH-9 as the mitigation) fails until
a poll happens to run. **Fix:** re-run `ingestPlanForCwd` (or read the file's
current hash) before retrying, and cover it in `detour-disposition.test.js`.

### S8 — The §9.2 static SQL scan silently skips any statement containing a quoted literal — and this is *not* the one-line fix the verifier assumed
`server/__tests__/chronology-ordering.test.js:48`

The body class `[^`'"]` terminates the match at the first `'` inside the SQL, so
`listPendingDetours` (`disposition = 'pending'`), `findOpenQueueItemByDigest`
(`status = 'pending'`) and `listFocusEvents` (`event_type = 'Focus'` — an
`events` query this very diff re-ordered) are never scanned. Measured: 5 of the
11 bulk-table `SELECT … LIMIT` literals are inspected.

I did **not** apply the fix inline: widening the class naively produces
cross-statement false matches, and the correct literal-first form (extract each
backtick/quote literal, then test `^\s*SELECT` + `LIMIT`) surfaces 3 pre-existing
`server/db.js` queries — two of them legitimate `GROUP BY … ORDER BY count DESC
LIMIT 5` top-N aggregates that need an explicit allow-list entry, one
`PostToolUse` events query that needs a look. That is a real (small) triage, not
a one-liner, and it should land with a suite run. Recommended shape:

```js
const lits = /`([^`]*)`|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
// then: const sql = m[1] ?? m[2] ?? m[3];
//       if (!/^\s*SELECT\b/i.test(sql) || !/\bLIMIT\b/i.test(sql)) continue;
```
with the two aggregate queries entered in `GRANDFATHERED_QUERIES` (dated), since
"top 5 tools by count" is legitimately not chronological.

### S9 — A stale-resolved detour is re-written with its *old* proposal, and `resolveDisposition`'s return value is ignored
`server/lib/reconciliation.js:371–383`

For a row from `listStaleResolvedDetours` already at `fold_in`/`new_item`,
`resolveDisposition` returns `{code:'ALREADY_RESOLVED'}` (correctly), the return
is discarded, and `applyDisposition` is called anyway. If that row is
`write_status='conflict'`, the fresh LLM verdict is silently dropped and the
*previous* proposal is written instead. **Fix:** check the return value the way
`routes/detours.js:100` does, and skip (or log) rather than write.

---

## Nits

- `server/lib/pace.js:54` — `item.checked === 1` only; a caller passing
  `checked: true` (any non-DB item object) silently reads as incomplete.
- `server/lib/reconciliation.js:32–33` — `MAX_TARGETS_PER_TICK` /
  `MAX_DETOURS_PER_TICK` are the only env knobs in this module without the
  `DASHBOARD_` prefix.
- `bin/ccam.js:2685` — new top-level `commands` verb added (to satisfy the
  registry help test) but absent from `COMMAND_GROUPS`/`help`/docs.
- `bin/ccam.js:2607` — `decisions: ["", "ack", ...]` includes an empty-string
  subcommand entry.
- `server/__tests__/single-writer-guard.test.js:98–110` — the first assertion is
  tautological (`every(f => expectedFiles.includes(f) || f === "plan-writeback.js")`)
  and the strong `deepEqual` is skipped when the scan finds nothing; the
  surrounding cases are sound.

---

## Checked and clean

- **§9.1 DERIVED-DUAL-VIEW, computation form:** `pace.js` is the only "is this
  item behind" implementation and layer 6 calls it (`reconciliation.js:118`);
  `DISPOSITIONS` is spelled once in `detours.js` and asserted against the SQL
  `CHECK` by `detour-disposition.test.js:27`. Scenario C
  (`reconciliation-full-tick.test.js:363`) is a genuine byte-parity test across
  both call sites — real writes, real ingest, only the spawn stubbed.
- **§9.2 row-id-as-chronology-proxy, query form:** all new `LIMIT`ed queries sort
  `created_at` (id tiebreak) before the limit; the R2 lookback windows on
  `inferred_at`; `recentEventSummaries`/`listFocusEvents` were additionally fixed
  off `id` order. No new instance found. (The test-side gaps are B6/S8.)
- **DEC-10:** no `target:` parse rule, no new `upsertPlanItem` column/arg;
  `target_date` is absent from the upsert `SET` list and the migration is the
  standard `try/SELECT/catch/ALTER`.
- **DEC-15:** both new tables land their full final shape (all `write_*`,
  `proposed_*`, `resolved_item_id`, widened `kind` CHECK) in the initial
  `CREATE TABLE`; `db-migration.test.js` covers the additive path.
- **WATCH-2:** the `missing_at` / zero-items filter is enforced in
  `listReconcileTargets` *and* re-checked at the top of `reconcileCwd`, i.e.
  before the LLM step, so both branches are covered.
- **`atomic-file.js` extraction:** behavior-preserving; the dropped
  `mkdirSync` is compensated at the one `cc-mutate.js` call site
  (`cc-mutate.js:248–253`), tmp is `wx` + unlinked on every failure path.
- **Docs (DEC-8):** `ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`,
  `server/README.md` and the `plan-ingest.js` header all had the "never writes
  the file" claim corrected — except the conflict-retry sentences called out in
  B4.
- **Scope:** no file outside the task list's change set was touched; no client
  changes (WATCH-3 holds); `check-headers.sh` exits 0.
- **`decisions.md` (verifier caveat 4b):** exists and is complete at
  `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-01-build-project-manager/decisions.md`
  — DEC-1…DEC-15, WATCH-1…WATCH-11 (incl. the WATCH-8/WATCH-11 build notes from
  Task 37) and the `3c2db7d` re-verification log. The verifier's "no
  decisions.md" note was a worktree-vs-main-checkout path confusion; there is no
  gap.
