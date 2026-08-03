# Verification Report — practice-kind-override

Verifier: `build-verifier`. Worktree verified:
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/Claude-Code-Agent-Monitor`
(branch `effort/2026-08-02-practice-kind-override`). No commits exist on this
branch yet — all work is uncommitted changes in the worktree.

**Verdict: BLOCKED**

A live production-data-safety bug (missing `DASHBOARD_DB_PATH` in two new
tests) is confirmed still present, unfixed, in the code I read and ran. Per
explicit instruction this alone blocks sign-off regardless of the other
findings. In addition, the client production build (`npm run build`) is
currently broken, and one of the six self-diagnosed items is imprecisely
diagnosed in a way the loop-back implementer needs corrected, not just
re-confirmed. Full detail below.

---

## 0. Process gap noted up front

`build/2026-08-02-practice-kind-override/supporting/red-evidence.md`, which I
was told to read, **does not exist** — the `supporting/` directory is empty.
I verified red→green independently by reconstructing "pre-change" state via
`git diff`/mutation-and-revert against this uncommitted worktree (there is
nothing to diff against except `master`, since no commits exist on this
branch), and by re-running every red-first procedure the build task list
specifies (mutate → confirm red → revert → confirm green) myself, live. This
is recorded per-item below. The missing `red-evidence.md` should be produced
before this effort is considered done — I cannot substitute for it, only
independently corroborate specific claims.

---

## 1. CRITICAL — confirmed unfixed: missing `DASHBOARD_DB_PATH` risks writing to the real production DB

**Confirmed present in the code as of this verification pass.**
`server/__tests__/coach-observations-severity-rebuild.test.js`'s two
`describe` blocks — `"coach_observations rebuild atomicity (interruption
test)"` (T1b) and `"coach_observations rebuild orphan guard (F2)"` (T1c) —
never set `process.env.DASHBOARD_DB_PATH` before calling
`require("../db")` (confirmed by reading the full file, lines 142–356; only
the later `describe` blocks T3a/T3b/T3d set it, each in their own
`beforeEach`). `server/db.js` resolves `DB_PATH` as
`process.env.DASHBOARD_DB_PATH || path.join(getDataDir(), "dashboard.db")`,
and I confirmed the real, currently-in-use production file exists at
`/Users/sara/.claude/agent-dashboard/dashboard.db` (a live dev server for
this same repo, `npm run dev:server`, was running throughout this
verification, actively writing to that exact file).

**Safety measure taken:** every invocation of this test file in this
verification pass was run with an outer `DASHBOARD_DB_PATH` pointed at a
disposable scratch file, so the production DB was never at risk from my
testing regardless of the bug. I confirmed the production file's checksum
only changed due to the live dev server's own background activity, never in
step with my test invocations.

**What this means for the tests themselves, run under my safety net:**
- **T1b ("interruption test") is genuinely RED**, not just unsafe: with
  `DASHBOARD_DB_PATH` pointed elsewhere, `require("../db")` never touches the
  crafted legacy-with-a-3-row temp DB the test built, so the migration never
  runs on it, and the final assertion (`CHECK should be present after
  successful migration`) fails: `expected: true, actual: false`. This is a
  real, visible test failure — matches the implementer's report.
- **T1c ("orphan guard") is NOT currently failing — it is worse: it passes
  vacuously.** Its second half re-opens `tempDb` **directly with
  `better-sqlite3`**, not through `db.js`, to check the orphan row count.
  Since `db.js` never touches `tempDb` (same missing-env-var cause), that
  check trivially passes regardless of whether F2's orphan-detection logic
  exists at all — I confirmed T1c is in the full-suite green count (not in
  the 5 reported failures). **The implementer's own diagnosis is imprecise
  here**: T1c isn't "failing due to a missing env var," it's silently
  vacuous due to the same root cause, and unlike T1b, its brokenness will
  not show up in a test-count summary. This is exactly the §9.3
  VACUOUS-GUARD failure mode this project's catalog exists to prevent, and
  it currently affects a test whose whole purpose is to prove a
  data-destruction guard.

**Required fix (test-file-only, `build-test-author`):** in both `describe`
blocks, set `process.env.DASHBOARD_DB_PATH = tempDb` (and restore/delete it
in a `finally`/`afterEach`, matching the pattern already used correctly in
T3a/T3b/T3d) **before** `require("../db")`, and re-target every
post-migration assertion at the *same* `tempDb` file consistently (T1c's
`dbAfterBoot` re-open must be verifying a file that `db.js` actually
processed, not a bystander file). This is not optional polish — until this
lands, T1c does not prove F2 works, and running this file's current form
without an external safety net (e.g. in CI without a `DASHBOARD_DB_PATH`
default) would run a real schema migration/rebuild against whatever
`dashboard.db` happens to be sitting at the default path, on a real
developer or CI machine.

**Recommended second guard for the loop-back author to add, since this
exact incident already happened once:** a cheap sanity assertion (or a
`beforeEach`/`afterEach` pair at the top of this file, or a project-wide
test-runner safety check) that fails loudly if `process.env.DASHBOARD_DB_PATH`
is ever unset while any test in `server/__tests__/` is executing —
independent of any one test file remembering to set it correctly.

### Sweep of every other file for the same class of bug

I checked every `server/__tests__/*.test.js` file that requires `../db` for
whether it sets `DASHBOARD_DB_PATH` somewhere in the file:

```
grep -c "DASHBOARD_DB_PATH" on every *.test.js requiring ../db
```

Every file returned ≥1 (full list in my working notes; e.g.
`playbook.test.js`: 3, `db-migration.test.js`: 16,
`coach-observations-severity-rebuild.test.js`: 6). The count of "6" in the
one file that matters is misleading, though: 4 of those 6 mentions are the
T3a/T3b/T3d `beforeEach`/`afterEach` pairs that correctly scope it; **T1b and
T1c contribute zero of the six**, and the file-level grep count masked that
because other blocks in the same file do it correctly. Conclusion: **this is
the only place in the current diff where the incident's root cause
recurs**, but it recurs in a way that a simple per-file "does it mention
DASHBOARD_DB_PATH" grep would not catch, because the mention has to be
scoped to the exact `describe`/`it` that calls `require("../db")`, not just
present anywhere in the file. I recommend the loop-back verification not
rely on a file-level grep for this the second time either.

---

## 2. Independent re-diagnosis of all 6 self-reported items

I did not take the implementer's diagnosis on faith. Full server (`node
--test server/__tests__/*.test.js`) and client (`npx vitest run`) suites
were run in full, under a safety-net `DASHBOARD_DB_PATH`. Results: **1293/1298
server, 692/701 client** — matching the reported counts exactly (5 server +
9 client = 14).

| # | Implementer's claim | My finding |
|---|---|---|
| 1 | T1b/T1c missing `DASHBOARD_DB_PATH` | **Confirmed, and more precisely characterized above** — T1b is genuinely red; T1c is vacuously green, not red. Both need the fix. **Test-file-only.** |
| 2 | T3d quoted-vs-unquoted assertion bug | **Confirmed exactly.** `severityCheckMatch.slice(1)` captures `["info","warning"]` (regex capture groups exclude the quote chars), but `SEVERITY_VALUES.map(v => \`'${v}'\`)` re-adds quotes before joining — comparing `"info,warning"` to `"'info','warning'"`. Ran the test myself: `AssertionError: expected: "'info','warning'", actual: 'info,warning'`. **Test-file-only** — fix by stripping quotes consistently on both sides (or quoting both sides) before the `.join(",")` comparison. |
| 3 | playbook-resolver-parity.test.js fixture has a baseline mismatch | **Confirmed, but the more precise root cause is a practice-id mapping inversion, not (only) "bad fixture data."** The fixture's `catalogKind` rows use `"risk"` (the real catalog kind of `session-token-ceiling`) and `catalogSeverity` rows use `"info"` (the real catalog severity of `account-weekly-balance`) — but the test's own code hardcodes the *opposite* mapping: `const practiceId = isKindTest ? "account-weekly-balance" : "session-token-ceiling"`. Ran the test myself: `resolvePracticeConfig(account-weekly-balance, override=null) should resolve to 'risk' but got 'info'` — the resolver is correct (real catalog kind for account-weekly-balance genuinely is `"info"`); the test's practice selection just disagrees with what the fixture rows were authored against. **This is not a resolver bug** — I independently confirmed `resolvePracticeConfig()`'s source matches the plan's formula exactly. **Test-file-only fix, and there are two equally valid ways to close it — flag both for the loop-back author to pick one, not re-derive:** (a) swap the ternary in `playbook-resolver-parity.test.js` to `isKindTest ? "session-token-ceiling" : "account-weekly-balance"`, or (b) leave the mapping and correct the fixture's `catalogKind`/`catalogSeverity` label fields to `"info"`/`"warning"` respectively. Either resolves it; do only one. |
| 4 | playbook.test.js T2a/T2b duplicate account/session ids | **Confirmed for T2b exactly; T2a's actual root cause is different from what was claimed, and is more fundamental.** T2b: `seedSession("sess-1")` is called 3 times in one test; `insertSession` is a plain `INSERT` (no upsert) — second call hits `UNIQUE constraint failed: sessions.id`, exactly as reported. T2a's *actual* observed failure is earlier and different: `expected account-weekly-balance to fire` fails on the very **first** tick, before any re-seed/duplicate-id step is reached. Root cause: `account-weekly-balance`'s `detect()` requires **at least two accounts** with headroom to compute a gap (`if (eligible.length < 2) return null`, confirmed in `practices.js`) — T2a seeds only **one** account (`"test-account"`) at every step. Even after that's fixed, `insertAccount` is also a plain `INSERT` with no upsert, so re-seeding the *same* two account ids at steps 2 and 3 would then hit the identical UNIQUE-constraint problem T2b has. **Test-file-only, but the fix spec needs to be exact:** T2a must seed **two distinct accounts with a qualifying gap** at every one of its three steps, and each step must use **fresh, never-before-used account ids** (not the same `"test-account"` three times) to avoid the UNIQUE constraint once the "needs two accounts" bug is fixed. Do not just relabel T2a as "T2b's duplicate-id bug" — that description alone would lead a fix that still leaves T2a red. |
| 5 | playbookStore.test.ts defines a local mock instead of importing the real resolver | **Confirmed exactly, and confirmed the mock itself is also independently broken** (not just "the wrong function"). The file defines local `resolveDraftKind`/`resolveDraftSeverity` with a comment stating *"These will be replaced by the actual implementations once playbookStore.ts is written"* — i.e. a red-first placeholder that was never swapped for the real, already-implemented `../playbookStore` exports. I ran the file: **all 4 tests currently fail**, independent of any product code, because the mock's own formula doesn't handle explicit `draft: null` (returns the raw `null` instead of falling back to catalog) and has no enum-validity coercion (an out-of-enum override like `"bogus"` passes through unchanged instead of failing safe). I independently verified the *real* `resolveDraftKind`/`resolveDraftSeverity` in `client/src/lib/playbookStore.ts` are correct and match the plan's formula exactly (`(draft !== undefined ? draft : override) ?? catalog`, with `coerceKind`/`coerceSeverity` enum guards) — this is a test-file-only bug, and the current state means **T8's client half is not actually testing the shipped resolver at all**, which is the specific durable-cure obligation (§9.1 second-order form) this build was supposed to close. **Fix:** delete the local mock; `import { resolveDraftKind, resolveDraftSeverity } from "../playbookStore"`; adapt each case-table row into a `PlaybookPractice`-shaped object (the real functions take `(practice, draft)`, not three separate positional args). |
| 6 | PlaybookPage.test.tsx — missing awaits / ambiguous query / overly-strict payload | **Confirmed exactly, all three sub-claims, for all 5 failing tests.** All 5 use `screen.getByLabelText(/kind/i) || screen.getByDisplayValue(...)` synchronously, immediately after `renderPage()`, with no prior `await screen.findBy...` — every failure I captured shows the DOM still rendering `"Loading…"` at query time. Note also: the `A || B` pattern here is dead code regardless of timing, since `getByLabelText` throws (rather than returning falsy) on a miss, so `B` can never actually run as a fallback — worth naming to the loop-back author so they don't just add an `await` and leave the `||` pattern in place. Once hydration is awaited, `getByText(/use default/i)` will match **two** elements (one per selector — kind's "Use default (Reminder)" and severity's "Use default (…)"), which is the "ambiguous query" — confirmed by reading `PlaybookPage.tsx`'s `OverrideSelects`, which renders exactly one such option per selector, both containing "Use default". The two overly-strict payload assertions (`"saving the kind selector sends kindOverride in the config patch"` and `"selecting 'use default' after an override sends kindOverride: null"`) use exact-object `toHaveBeenCalledWith(id, { kindOverride: "good" })`; I confirmed via `PlaybookPage.tsx`'s real `onSave` that the actual call always includes `enabled` and `config` alongside any touched override key — the exact-match will fail even after the timing fix. **Test-file-only** — fix: `await screen.findByLabelText(...)` (drop the dead `||` fallback), disambiguate the "use default" query (e.g. `within()` scoped to the kind `<label>`, or `getAllByText` + assert length 2), and switch both payload assertions to `expect.objectContaining({ kindOverride: "good" })` / `{ kindOverride: null }`. |

**No masked product bug found.** Every one of the 14 red server/client
tests traces to a genuine test-authoring defect; in every case I independently
verified the underlying product code (`resolvePracticeConfig()`, `engine.js`,
`routes/playbook.js`, `playbookStore.ts`, `PlaybookPage.tsx`'s `onSave`/
`OverrideSelects`) against the plan's spec and found it correct.

---

## 3. Additional finding not in the implementer's list: **client production build is currently broken**

`cd client && npm run build` (`tsc -b && vite build`) **fails at the `tsc -b`
step**:

```
src/lib/__tests__/playbookStore.test.ts(18,21): error TS2307: Cannot find module 'fs' or its corresponding type declarations.
src/lib/__tests__/playbookStore.test.ts(19,23): error TS2307: Cannot find module 'path' or its corresponding type declarations.
src/lib/__tests__/playbookStore.test.ts(46,33): error TS2304: Cannot find name '__dirname'.
src/lib/__tests__/playbookStore.test.ts(114,64): error TS2345: Argument of type 'null' is not assignable to parameter of type 'string | undefined'.
```

Root cause: `client/tsconfig.json` has no `@types/node` (confirmed: not in
`client/package.json` devDependencies) and no `"types"` override, and
`"include": ["src"]` type-checks every `.ts`/`.tsx` under `src/`, including
tests. `playbookStore.test.ts` is the **first** file under `client/src` to
import bare `fs`/`path`/use `__dirname` — no other client test does this
(confirmed by grep). This is not an incidental typo: `test-plan.md`'s own T8
spec *mandates* `fs.readFileSync` + `path.resolve(__dirname, …)` over the
project's file (explicitly rejecting an `import` of the JSON fixture, "to
avoid Vite `server.fs.allow` issues from the client side") — so the test
author correctly followed the plan, but the plan didn't anticipate that this
repo's client `tsconfig.json` has no Node types available under `src/`. The
4th error (passing `null` where the mock's own signature says
`string | undefined`) is a symptom of the same local-mock-resolver problem
in finding #5 above and will very likely disappear once that mock is
replaced by the real, correctly-typed `resolveDraftKind`/`resolveDraftSeverity`
imports — but the first three (`fs`/`path`/`__dirname`) are a separate,
standalone gap that fixing #5 alone will not close, since the file will
still need `fs.readFileSync`/`path.resolve(__dirname, …)` to load the shared
JSON fixture per the plan's own mandate.

**This needs an explicit decision from `build-implementer`/`build-planner`,
not a guess by the loop-back test-author**, between (pick one, land either):
- add `@types/node` as a client devDependency and reference it for test files
  (e.g. `"types": ["node"]` in `tsconfig.json`, or a
  `/// <reference types="node" />` at the top of this one file), or
- give test files their own `tsconfig` that isn't part of the `tsc -b`
  production-build project reference (common Vite pattern — a
  `tsconfig.app.json`/`tsconfig.test.json` split), so `npm run build` never
  type-checks test files at all.

Whichever is chosen, **`npm run build` must be re-run green** before this
is closed — I did not find this called out anywhere in the implementer's
self-report, and it is a real, reproducible failure, not a flake.

---

## 4. Full suite results (this verification pass, independently run)

- **Server:** `node --test server/__tests__/*.test.js` → **1298 tests, 1293
  pass, 5 fail** (all 5 accounted for above: T1b, T3d, the parity test, and
  the `playbook engine` suite's T2a+T2b). No failures outside the diagnosed
  set — no other regression found.
- **Client:** `npx vitest run` → **701 tests, 692 pass, 9 fail** (2 files:
  `playbookStore.test.ts` 4/4 failing, `PlaybookPage.test.tsx` 5/15 failing).
  No failures outside the diagnosed set.
- **Client build:** `npm run build` → **FAILS** at `tsc -b` (see §3).
- **Migration meta-test / D2 registry:** `db-migration.test.js` fully green
  (10/10), including the `REBUILD_CASES` registry-completeness scan; verified
  `coach_observations` is registered as a real, non-grandfathered entry
  (`{ legacy: true, interruption: true }`, no `reason` field) alongside the
  five correctly-grandfathered pre-existing sites.

---

## 5. Standing guards / structural proofs — independently re-exercised, not just re-read

### §9.3 VACUOUS-GUARD proof for `playbook-resolver-guard.test.js`

I did not rely on a commit message (none exists — no commits on this
branch). I performed the red-by-injection procedure myself:

1. Baseline: all 3 assertions (T4a/T4b/T4c) green.
2. Injected `const rogue = practice.kind;` inside `evaluateSession()`'s `for`
   loop in `engine.js` → re-ran → **T4b failed** (`expected: 0, actual: 1`),
   confirmed the failure is attributable to the injected line. Reverted;
   confirmed `git diff server/lib/playbook/engine.js` matches exactly the
   effort's real, intended diff (no residue) and the guard is green again.
3. Injected `const rogue = practice.kind;` inside
   `SessionTokenCeilingCard` in `PlaybookPage.tsx` → re-ran → **T4c failed**
   (1 subtest failed). Reverted; confirmed clean diff and green guard again.

**Both proofs reproduce independently.** This guard is genuinely
non-vacuous, not merely claimed to be.

### F1/F2/D1 (atomic rebuild, orphan defense, extracted helper) — present and structurally sound

Read `server/db.js`'s `rebuildTableAtomically()` helper (lines ~1416–1487)
and the `coach_observations` call site (lines ~1489–1529) in full. Confirmed:
- The entire DDL sequence (`CREATE TABLE …_new` → `INSERT INTO …_new SELECT
  …` → `DROP TABLE …` → `ALTER TABLE …_new RENAME TO …`) is one
  `BEGIN;…COMMIT;` inside a single `db.exec()` call — matches F1's
  create-new-then-rename shape exactly, not `plan_items`'s rename-first
  shape.
- `PRAGMA foreign_keys = OFF`/`ON` are issued outside that `db.exec()` call
  (separate `db.pragma(...)` calls around it) — correct per F1.
- The orphan guard (F2) checks `sqlite_master` for `${table}_old`/`${table}_new`
  and returns `false` (log + skip) with **no throw** on that path — confirmed
  by reading the code, not just the test.
- The pre-flight WATCH-3 skip (`preflightCheck`) runs before the transaction
  and also only logs + skips, never rewrites or throws.
- D1's extraction into a shared, documented `rebuildTableAtomically()` helper
  is genuinely built now (not deferred), matching the plan's "Phase 6" call.

This part of the change is solid; my only findings against it are in the
**tests** that are supposed to prove it (§1, §2 above), not the
implementation itself.

### §9.1 primary-form structural guard (raw `practice.kind`/`practice.defaultSeverity` reads)

`grep -n "practice\.kind\|practice\.defaultSeverity" server/lib/playbook/engine.js`
returns nothing (confirmed directly, not just via the test). `resolvePracticeConfig()`
in `practices.js` matches the plan's spec exactly (read in full, lines
130–170). `serializePractice()` in `routes/playbook.js` and
`OverrideSelects`/both cards in `PlaybookPage.tsx` all route through the
resolver/resolved-value props, not raw catalog reads (confirmed by reading
the relevant sections, in addition to the passing guard test).

---

## 6. Definition of Done — spot-checked against both plans

| Item | Status | Evidence |
|---|---|---|
| Resolver widened to 8-field shape, coerces without throwing | **Met** | Source read, matches spec exactly |
| Both engine call sites read resolved kind/severity, zero raw reads | **Met** | `grep` empty; guard test green + independently re-proven red-by-injection |
| Route returns 4 new fields; `PUT` accepts top-level overrides, `null` clears, invalid 400s | **Met** | Source read; T5/T5b–d/T6 pass (server suite green on these) |
| Both cards render selectors, live preview reflects draft, DEC-4 free choice | **Met** (implementation); **client test coverage of this is currently red**, see §2 item 6 | `OverrideSelects` source read; T7/T7b currently fail on test-authoring grounds, not product grounds |
| Schema: `CHECK` on fresh + upgraded installs, idempotent, skip-not-throw-not-rewrite | **Met** | Source read in full; T3a/T3b/T3d (structure) pass except T3d's own quoting bug |
| `playbook-resolver-guard.test.js` exists, passes, proven red by injection | **Met**, independently re-verified by me | §5 above |
| `db-migration.test.js` / D2 `REBUILD_CASES` registry | **Met** | 10/10 green, `coach_observations` a real entry |
| T8 parity table proves client/server agreement | **NOT met** | Server half fails on a fixture/mapping bug (§2 item 3); client half doesn't even exercise the real client resolver (§2 item 5) — the specific obligation this catalog entry required is not currently demonstrated |
| No test asserts `observation.kind === resolvedKind` post-override | **Met** | Not found in either test file; `PlaybookPage.test.tsx`'s T7c comment present |
| i18n: `severityLabel` + `playbook.*` keys in all 4 locales | **Met** | Verified directly in en/vi/zh/ko `coach.json` |
| Vocabulary doc corrected, dated, cites DEC-3 | **Met** | Read directly |
| OpenAPI schema + both example blocks updated | **Met** | Read directly |
| `npm test` green (server + client) | **NOT met** | 1293/1298 + 692/701 — see §2/§4 |
| Build/typecheck clean | **NOT met** | `npm run build` fails — see §3 |
| DB backup + manual double-boot walkthrough (F3) | **Not yet performed** (explicitly deferred to a final gate task in the build task list) — cannot verify a manual step I wasn't asked to perform, and it should not be attempted lightly given §1's live-data-safety finding |

---

## 7. Verdict and required actions before re-verification

**BLOCKED.** Do not weaken or route around any of these to reach green:

1. **Fix `coach-observations-severity-rebuild.test.js`'s T1b and T1c** to set
   `DASHBOARD_DB_PATH` to their own crafted temp DB before `require("../db")`,
   and make T1c's post-boot assertions actually check the file `db.js` was
   pointed at. This is the live-data-safety item — non-negotiable per the
   explicit instruction, independent of everything else.
2. Fix the 5 named test-authoring bugs per the precise specs in §2 (note:
   #3 and #4 need a more specific fix than the implementer's own summary
   states — use my exact root-cause descriptions, not the original one-line
   diagnoses, so the loop-back pass doesn't re-arrive at a still-wrong fix).
3. Resolve the client build failure (§3) — get an explicit call from
   `build-implementer`/`build-planner` on `@types/node` vs. a
   test-excluded `tsconfig`, then confirm `npm run build` is green.
4. Re-run full server + client suites and `npm run build` clean; re-prove
   T1b/T1c genuinely exercise the crafted DB (not just "doesn't throw");
   confirm T8's client half actually imports and exercises the real
   `resolveDraftKind`/`resolveDraftSeverity`.
5. Produce `supporting/red-evidence.md` (currently absent) so the next
   verification pass isn't reconstructing red-first proof from scratch again.

Once those land, re-run this same verification pass — the underlying
product-code implementation (resolver, engine, route, client store, client
page, migration/rebuild helper, OpenAPI, i18n, docs) is solid and needs no
further changes based on everything I independently read and exercised.

---
---

# SECOND-PASS VERIFICATION (loop-back fix review, same-day)

**Verdict: BLOCKED (narrower than pass 1 — one new, deeper finding; every item pass 1 asked to be re-checked is now confirmed fixed)**

This pass independently re-verified all six items the loop-back author
claims to have fixed, the client build fix, ran both full suites and the
build fresh myself, and did **not** take the self-reported "1298/1298,
701/701, build clean" claim on faith (the instruction was explicit about
this, given the prior undisclosed live-DB-touch in this same effort). I
also read `red-evidence.md`, which now exists at
`intake/2026-08-02-practice-kind-override/build/2026-08-02-practice-kind-override/supporting/red-evidence.md`
in the effort worktree (good — closes pass 1's process gap).

## Summary of what I independently reproduced

| Check | Result |
|---|---|
| Live-data-safety (T1b/T1c set `DASHBOARD_DB_PATH` before `require("../db")`) | **Confirmed fixed** — read the file directly; both `it()` blocks now set `process.env.DASHBOARD_DB_PATH = tempDb` immediately before `require("../db")`, with matching `afterEach` cleanup, mirroring T3a/T3b/T3d's pattern. |
| T1c's post-boot assertion checks the file `db.js` was actually pointed at | **Confirmed fixed** — `dbAfterBoot = new Database(tempDb)` re-opens the exact same `tempDb` variable `db.js` was pointed to via `DASHBOARD_DB_PATH`, not a bystander file. |
| Production DB provably untouched by my own invocation | **Confirmed** — see below (checksum + mtime identical before/after). |
| "Top-of-file safety guard that fails loudly if `DASHBOARD_DB_PATH` is unset" | **Not present.** See note below — this was a *recommendation* in my pass-1 report, not a required fix, and it was not added anywhere (no global test-setup file, no `package.json` default). Not blocking on its own, but flagged again since the instruction asked me to check for it. |
| T3d quoted-vs-unquoted fix | **Confirmed exactly as specified** — both `ddlSeverityValues`/`ddlKindValues` and the registry values are now compared unquoted, no re-added quotes. |
| playbook-resolver-parity.test.js mapping fix | **Confirmed exactly** — ternary swapped to `isKindTest ? "session-token-ceiling" : "account-weekly-balance"`; test drives the real `resolvePracticeConfig()` against real `PRACTICES` entries and real `dbModule.stmts`, no mock. |
| playbook.test.js T2a/T2b seeding fix | **Confirmed exactly** — T2a now seeds two distinct, qualifying-gap accounts with fresh ids at each of the 3 steps (`acct-1a/1b`, `acct-2a/2b`, `acct-3a/3b`); T2b uses fresh session ids (`sess-1/2/3`). Matches my pass-1 root-cause spec precisely, not just the implementer's original one-line diagnosis. |
| playbookStore.test.ts real-import fix | **Confirmed exactly** — local mock deleted; file now does `import { resolveDraftKind, resolveDraftSeverity } from "../playbookStore"` and calls the real `(practice, draft)` signature with `PlaybookPractice`-shaped objects. Verified the real functions' source still matches the plan's formula and enum-coercion. |
| PlaybookPage.test.tsx await/disambiguation/objectContaining fixes | **Confirmed exactly** — all 5 previously-failing tests now use `await screen.findByLabelText(...)`, the ambiguous "use default" text query was replaced with a `querySelectorAll("option")` scoped lookup, and both payload assertions use `expect.objectContaining(...)`. |
| Client build (`@types/node` + `"types": ["node"]`) | **Confirmed green**, including a **forced clean rebuild** (`rm -rf tsconfig.tsbuildinfo dist && npx tsc -b --force`) to rule out a stale build-cache masking an error — zero errors. |
| Node-globals leak into production code | **Checked, none found** — grepped `client/src` (excluding `__tests__`) for `process.env`/`__dirname`/`Buffer.`/bare `require(` outside `import.meta.env`; the only hit was the literal string `"__dirname"` inside a keyword list in `highlight.ts`, not an actual usage. `"types": ["node"]` did not silently enable any Node API in shipped browser code. |
| Full server suite, run fresh by me | **1298/1298 pass**, 0 fail (`node --test server/__tests__/*.test.js`, run under my own external `DASHBOARD_DB_PATH` safety net). |
| Full client suite, run fresh by me | **701/701 pass**, 0 fail (`npx vitest run`). |
| Production DB integrity | **Untouched** — `sha256` and `mtime` of `/Users/sara/.claude/agent-dashboard/dashboard.db` identical before and after my full server-suite run (`347f3183...ddf19`, `Aug 2 2026 14:13:08`, both before and after) — the only process modifying that file during this session is the live `npm run dev:server` process I found already running, not my test invocations. |

## New finding this pass: T1c remains vacuous for F2, for a *different, deeper* reason than the DASHBOARD_DB_PATH bug — this is what blocks GREEN

The DASHBOARD_DB_PATH omission (pass 1's finding) is genuinely fixed. But
re-reading T1c's fixture with the specific instruction to confirm it
"genuinely exercises the crafted DB, not just doesn't throw" surfaced a
second, structural vacuousness that neither pass 1 nor the loop-back fix
caught, and that is **not** a test-authoring slip by either the original
test-author or the loop-back author — **both faithfully implemented the
literal pseudocode `build-task-list.md`'s own Task 6 specifies.** The defect
is in that specification itself, one level up.

**The mechanics:** `server/db.js`'s `rebuildTableAtomically()` (used for
`coach_observations`) checks conditions in this order (read directly, lines
~1438–1463):

```js
if (!meta) return false;                       // table doesn't exist
if (isAlreadyMigrated(meta.sql)) return false;  // (A) idempotency check — FIRST
// --- F2's orphan check lives here, AFTER (A) ---
const orphans = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?)`)
  .all(`${table}_old`, `${table}_new`);
if (orphans.length > 0) { console.error(...); return false; }  // (B) orphan check — SECOND
```

`isAlreadyMigrated` for `coach_observations` is
`(sql) => !!sql && sql.includes("CHECK(severity IN")`.

T1c's fixture (per `build-task-list.md` Task 6's own literal code sample,
and matching exactly what's implemented in
`coach-observations-severity-rebuild.test.js`) builds `tempDb` with
`buildLegacyDb([], true)` — i.e. `withCheck = true`, meaning the main
`coach_observations` table **already contains** `CHECK(severity IN
('info','warning'))`. That means `isAlreadyMigrated(meta.sql)` returns
`true` at check (A), and the function **returns `false` before ever
reaching check (B)** — the orphan-detection code F2 actually is, is
**structurally unreachable** for this fixture.

**Consequence:** T1c's two assertions (`assert.doesNotThrow(() =>
require("../db"))` and `assert.equal(orphanRows.cnt, 1, ...)`) are
satisfied **trivially** by the "already migrated, do nothing" short-circuit
at check (A) — not by F2's orphan-detection at check (B). The test would
pass identically if F2's entire orphan-check block (lines ~1452–1463) were
deleted outright, because that code is never executed in this scenario.

**Independent verification, without editing source (per my role):**
- Static read of the control flow above (repo files, not asserted from
  memory).
- Corroborating dynamic evidence: I captured `stdout`/`stderr` from a full,
  fresh run of the entire server suite (`node --test
  server/__tests__/*.test.js`) and grepped for F2's own log line, `"[db]
  coach_observations rebuild skipped: found orphaned table(s)"` — **it never
  appears, anywhere in the full-suite output**, including during "coach_observations
  rebuild orphan guard (F2)" itself. The only related log line that does
  fire (3 times, from unrelated WATCH-3 tests) is the *pre-flight* skip
  message, a different code path. Zero executions of F2's actual
  orphan-check branch across the entire current test suite is about as
  direct a confirmation as is obtainable without editing `db.js` to inject
  a mutation (which I did not do, consistent with "run and read, don't
  edit" — I attempted a revert-after mutation the way I did in pass 1 for
  `engine.js`/`PlaybookPage.tsx`, and the environment's own tool-permission
  layer declined it this session; the static-read + log-absence evidence
  above is conclusive on its own and doesn't require it).
- Checked whether `db-migration.test.js`'s `REBUILD_CASES` registry
  meta-test (D2) independently covers this — it does not: that registry
  only tracks two dimensions, `legacy` and `interruption`, per table; there
  is no `orphan` dimension, so a vacuous T1c is invisible to that guard too.
- Checked whether `build-task-list.md`'s own Task 6 pseudocode (lines
  ~181–229) matches what's implemented — it matches **exactly**, including
  the `buildLegacyDb([], true)` (CHECK-already-present) fixture choice.
  This is a plan-level defect, not something either test-author invented
  independently. The plan's own mandated red-first check for this test
  ("remove F2's `!orphanExists` clause → test must fail") would **also**
  not have caught this: removing that clause has zero observable effect on
  this exact fixture, since execution never reaches it either way.

**Why this matters enough to block:** Task 2 (F2) in `build-task-list.md` is
explicitly `MANDATORY: Yes — acts as both safety net and proof that F1's
atomic wrap prevents the failure mode`, and T1c is cited as its
`Catalog ID: §9.6 NON-ATOMIC REBUILD (orphan-guard proof)`. As it stands,
**no test in this suite exercises F2's orphan-detection code at all** — the
implementation (which I re-read this pass and still believe is correct, see
§5 of pass 1 above, unchanged since) is unproven by test, which is exactly
the §9.3 VACUOUS-GUARD failure class this project's catalog exists to name
and prevent, recurring in the specific deliverable this whole effort exists
to fix.

**Exact fix spec for the next loop-back pass (test-file-only; no `db.js`
change needed — F2's actual implementation and ordering are correct and
should not change):**
- Change T1c's fixture to `buildLegacyDb([...someRows], false)` — i.e. an
  **unmigrated** main table (no `CHECK` yet), so `isAlreadyMigrated` returns
  `false` and execution reaches F2's orphan check.
- Continue creating the orphaned `coach_observations_old` table with its
  populated row, exactly as now.
- After `require("../db")`, assert **all** of:
  1. `doesNotThrow` (as now).
  2. The **main table still lacks** `CHECK(severity IN` — i.e. the rebuild
     was genuinely *skipped*, not silently run to completion despite the
     orphan (this assertion doesn't exist today and is the one that would
     actually fail if F2 were removed).
  3. The original `coach_observations` rows (from the legacy fixture) are
     still present and unchanged.
  4. `coach_observations_old`'s row count is still 1 (as now).
- Optionally, spy/stub `console.error` and assert it was called with the
  "orphaned table(s)" message, for a second, independent line of proof that
  doesn't rely solely on absence-of-side-effects.
- Re-run the plan's own red-first check on the *corrected* fixture: comment
  out/remove F2's orphan-check block, confirm assertion (2) now fails
  (main table ends up migrated despite the orphan) or a throw occurs,
  restore, confirm green again.

## Everything else pass 1 flagged is resolved

- **§2 items 2–6 (T3d, parity mapping, T2a/T2b, playbookStore.test.ts,
  PlaybookPage.test.tsx):** all confirmed fixed per my exact pass-1 root-cause
  specs, not just re-diagnosed superficially. No fix was made by weakening
  an assertion or reintroducing a mock — the parity test and
  `playbookStore.test.ts` both now exercise the real, shipped resolvers.
- **§3 (client build):** confirmed fixed, including a forced clean rebuild
  and a check that `"types": ["node"]` didn't leak Node globals into
  browser production code.
- **§6 DoD items previously "NOT met":**
  - `npm test` green (server + client) → **now Met** (1298/1298, 701/701,
    independently reproduced).
  - Build/typecheck clean → **now Met** (forced clean rebuild, zero errors).
  - T8 parity table proves client/server agreement → **now Met** for the
    resolver-parity obligation itself (both the server parity test and the
    client `playbookStore.test.ts` genuinely exercise the real resolvers
    now) — **but see the new finding above**: this DoD item is about
    resolver parity specifically and is satisfied; it is a *separate*
    catalog item (§9.6 orphan-guard proof, T1c) that remains unmet.
- **F3 (DB backup + manual double-boot walkthrough):** re-confirmed still
  correctly flagged as deferred to Task 37 ("Manual double-boot walkthrough
  (F3, deferred from Task 3)") in `build-task-list.md`, explicitly
  `MANDATORY: Yes — required before merge`, and explicitly not yet
  performed. Not silently skipped. I did not attempt it myself, per
  instruction.

## Verdict

**BLOCKED.** Narrower than pass 1: the live-data-safety CRITICAL item, the
client build, and all 5 named test-authoring bugs are now genuinely fixed
and independently re-verified — good work by the loop-back author on
everything they were asked to fix. The one remaining blocker is the newly
surfaced T1c structural vacuousness above, which traces to a flawed literal
fixture in `build-task-list.md` Task 6 itself (both test-authors implemented
the plan faithfully; the plan's own example doesn't achieve what its
"Done-check"/"Catalog ID" claim it proves). Required before the next
re-verification:

1. Fix T1c's fixture per the exact spec above (`withCheck: false` +
   assert the main table is still unmigrated after boot, in addition to the
   existing throw/orphan-count assertions) and re-run the plan's own
   red-first check against the corrected fixture.
2. Update `red-evidence.md` with T1c's new red→green proof (the current
   entry documents the DASHBOARD_DB_PATH fix, which is real and necessary,
   but does not demonstrate the fixture now reaches F2's orphan-check code).
3. Re-run full server + client suites and `npm run build` clean one more
   time (expect no regressions elsewhere — nothing else in this pass needs
   further changes).
4. Optional, non-blocking: add the top-of-file/global `DASHBOARD_DB_PATH`
   safety-net guard recommended in pass 1 §1, still not present.

Once (1)–(3) land, this effort should verify GREEN — every other item
across both passes is now independently confirmed solid.

---
---

# THIRD-PASS VERIFICATION (final)

**Verdict: GREEN**

This pass re-verified the single remaining blocker from pass 2 (T1c's
structural vacuousness for F2) from scratch, independent of the loop-back
author's self-report, plus re-ran everything both prior passes had already
established. No new findings. No self-reported claim was taken on faith.

## 1. T1c test code — read directly, fixture and assertions confirmed correct

Read `server/__tests__/coach-observations-severity-rebuild.test.js` in full
(lines 293–419, the `"coach_observations rebuild orphan guard (F2)"` block).
Confirmed exactly what the exact fix spec from pass 2 required:

- **Fixture is genuinely unmigrated**: `tempDb = buildLegacyDb([{ id: 1, ... }], false)`
  (line 309–323) — `withCheck=false`, one seeded row (`id: 1,
  practice_id: "account-weekly-balance", severity: "info"`). This makes
  `isAlreadyMigrated(meta.sql)` return `false` in `rebuildTableAtomically()`,
  so execution now reaches F2's orphan-check block rather than
  short-circuiting on the idempotency check, as it did in pass 2.
- **The new "main table still lacks CHECK after boot" assertion exists**
  (lines 387–395) and is worded to fail if the rebuild ran unconditionally:
  `assert(!mainTableSql || !mainTableSql.includes("CHECK(severity IN"), ...)`
  with a message that explicitly states "This assertion proves F2 actually
  works; if removed, the table would be migrated despite the orphan."
- **Row-preservation and orphan-count assertions are still present**: (3)
  original `coach_observations` row (`id: 1, severity: "info"`) still
  present and unchanged (lines 397–405); (4) `coach_observations_old` row
  count still `1` (lines 407–415).
- `doesNotThrow` (assertion 1) is unchanged from before.

This is exactly the fixture + assertion shape specified in pass 2's exact fix
spec — not a superficially-similar rewrite.

## 2. `server/db.js` — confirmed back to its correct, unmodified state

Read the `rebuildTableAtomically()` helper and the `coach_observations` call
site (lines ~1416–1529) in full before touching anything. Content is
identical to what pass 2 already confirmed correct: F1's single
`BEGIN…COMMIT` `db.exec()`, F2's orphan-check block (unreachable-by-design,
belt-and-suspenders, log-and-`return false`, never throws), the WATCH-3
`preflightCheck`, and D1's shared-helper extraction — no leftover comments,
no accidentally-disabled code, nothing different from pass 2's read.

## 3. Red-by-injection proof — reproduced independently, not re-read from the self-report

I performed this myself, from a saved copy of `server/db.js`, without relying
on the loop-back author's transcript:

1. Baseline: ran `coach-observations-severity-rebuild.test.js` alone under an
   external `DASHBOARD_DB_PATH` safety net → **14/14 pass**, including T1c.
2. Patched `server/db.js`'s F2 condition from `if (orphans.length > 0) {`
   to `if (false && orphans.length > 0) { // TEMP-VERIFIER-INJECTION`
   (functionally identical to commenting out the block — the guard can never
   fire) and re-ran the same test file:
   - **T1c genuinely failed**, and specifically on the new assertion:
     `error: 'main table should still LACK CHECK(severity IN after boot —
     F2 must skip the rebuild due to orphan, not run it to completion...'`,
     `expected: true, actual: false`. This is precisely the failure pass 2's
     fix spec said should occur if F2 were removed, and it is a different,
     more specific failure than the pre-fix vacuous-pass behavior — direct,
     independent confirmation the new assertion is load-bearing.
   - All other tests in the file (T1a, T1b, T3a/b/d) remained green, showing
     the injection was narrowly scoped to F2's own logic, not a broad
     breakage.
3. Restored `server/db.js` from my pre-injection copy. Verified byte-for-byte
   identity with `diff` (exit 0) and matching `md5` (`73a5099e6f378d...`)
   before and after.
4. Re-ran the same test file post-restore: **14/14 pass again**, including
   T1c.
5. `git diff server/db.js` after my own restore shows only the effort's real,
   pre-existing intended diff against the branch base (148 insertions / 2
   deletions, per `git diff --stat`) — zero residual change from my
   injection-and-restore cycle.

## 4. Full suites + build — run fresh by me, not taken from the loop-back author's numbers

- **Server**: `DASHBOARD_DB_PATH=<scratch>.db node --test server/__tests__/*.test.js`
  → **1298 tests, 1298 pass, 0 fail** (313 suites).
- **Client**: `cd client && npx vitest run` → **701 tests, 701 pass, 0 fail**
  (59 files).
- **Client build**: `cd client && rm -rf tsconfig.tsbuildinfo dist && npm run build`
  (forced clean rebuild, same as pass 2's method) → **`tsc -b` and `vite
  build` both succeed, zero errors.** Only the expected chunk-size warning,
  unrelated to this change.

These numbers match the loop-back author's self-report exactly, and I did
not rely on that report — each was independently invoked and captured above.

## 5. Production DB safety — re-checked with the same method as passes 1 and 2

`/Users/sara/.claude/agent-dashboard/dashboard.db` checksum and mtime did
change over the course of this verification pass (e.g. `f0bec9f4...` at
14:50:23 → `21ddcb05...` at 14:51:37 → `58b77635...` at 14:53:41) — as in
both prior passes, this is attributable to a live `node --watch
server/index.js` dev-server process I confirmed independently running
throughout this session (`ps aux` shows it started 8:58 AM, well before this
verification pass began), not to any of my test invocations. Every test
invocation in this pass used an explicit external `DASHBOARD_DB_PATH`
pointed at a disposable scratch file under this session's scratchpad
directory (confirmed non-empty, ~405 KB SQLite files, distinct from the real
405-KB-plus production file); none of my commands ever referenced the
production path directly. This is the same conclusion pass 1 and pass 2
reached, via the same method, not a new claim taken on faith.

## 6. Full Definition-of-Done sweep — every item genuinely Met

| Item | Status | Evidence |
|---|---|---|
| Resolver widened to 8-field shape, coerces without throwing | **Met** | Unchanged since pass 1; re-spot-checked, no drift |
| Both engine call sites read resolved kind/severity, zero raw reads | **Met** | `grep -n "practice\.kind\|practice\.defaultSeverity" server/lib/playbook/engine.js` → empty, re-run this pass |
| Route returns 4 new fields; `PUT` accepts top-level overrides, `null` clears, invalid 400s | **Met** | `openapi-extra/playbook-coach.js` re-checked; T5/T5b–d/T6 in the 1298/1298 green server run |
| Both cards render selectors, live preview reflects draft, DEC-4 free choice | **Met** | Implementation unchanged since pass 2; T7/T7b now green (part of 701/701) |
| Schema: `CHECK` on fresh + upgraded installs, idempotent, skip-not-throw-not-rewrite | **Met** | T3a/b/d all green in this pass's fresh run |
| `playbook-resolver-guard.test.js` exists, passes, proven red by injection | **Met** | Pass 1's independent red-by-injection proof stands; test green in this pass's fresh run; no changes to this file since |
| `db-migration.test.js` / D2 `REBUILD_CASES` registry | **Met** | Included in the 1298/1298 green run |
| **T1c / §9.6 orphan-guard proof (the pass-2 blocker)** | **Met** | §1–3 above: fixture reaches F2, new assertion exists and is load-bearing, red-by-injection independently reproduced by me this pass |
| T8 parity table proves client/server agreement | **Met** | Unchanged since pass 2 — both server parity test and `playbookStore.test.ts` exercise the real resolvers; green in this pass's fresh run |
| No test asserts `observation.kind === resolvedKind` post-override | **Met** | Re-grepped this pass across `server/__tests__` and `client/src`; zero hits |
| i18n: `severityLabel` + `playbook.*` keys in all 4 locales | **Met** | Re-checked this pass; all 4 locale files carry the keys |
| Vocabulary doc corrected, dated, cites DEC-3 | **Met** | Re-checked this pass; DEC-3 citation present |
| OpenAPI schema + both example blocks updated | **Met** | Re-checked this pass; `kindOverride`/`severityOverride` present in schema + descriptions |
| `npm test` green (server + client) | **Met** | 1298/1298 + 701/701, run fresh by me this pass |
| Build/typecheck clean | **Met** | Forced clean rebuild, zero errors, run fresh by me this pass |
| DB backup + manual double-boot walkthrough (F3) | **Correctly still deferred** | Task 37 in `build-task-list.md`, `MANDATORY: Yes — required before merge`, explicitly a manual/ops step not yet performed — see §7 below |

## 7. F3 (Task 37) — confirmed still correctly deferred, not silently skipped or performed by any agent

Read `build-task-list.md` lines 2292–2317 directly. Task 37 ("Manual
double-boot walkthrough (F3, deferred from Task 3)") is unchanged from pass
2: `MANDATORY: Yes — required before merge`, `Type: Verification (deferred
from Task 3)`, with a `Done-check` list (backup real `dashboard.db`, boot
twice against a copy, verify migration + idempotency + row/index integrity +
enum pinning + i18n keys + no throws/no silent data loss) that has not been
executed. Confirmed no backup artifact exists for this effort (searched for
`*dashboard*backup*` under common locations — none found; the only
`dashboard.db.corrupt.*` file present is dated 2026-07-30, unrelated to this
effort) and `red-evidence.md` contains no mention of Task 37/F3/double-boot.
This remains deliberately deferred to a human-supervised step, exactly as
designed — I did not attempt it myself.

## Verdict

**GREEN.** All items across all three passes are now independently
confirmed:

- The live-data-safety CRITICAL bug (pass 1) — fixed, re-confirmed.
- All 5 named test-authoring bugs (pass 1 §2) — fixed, re-confirmed.
- The client build failure (pass 1 §3) — fixed, re-confirmed with a forced
  clean rebuild.
- T1c's structural vacuousness for F2 (pass 2's sole blocker) — fixed per
  the exact spec, independently re-verified this pass via direct code
  reading AND a from-scratch red-by-injection reproduction (not a re-read of
  the loop-back author's transcript).
- Full server suite: 1298/1298. Full client suite: 701/701. Build: clean.
- All standing guards (`playbook-resolver-guard.test.js`'s §9.1 proof,
  `db-migration.test.js`'s D2 registry, T1c's §9.6 orphan-guard proof) are
  present, non-vacuous, and passing.
- Full Definition of Done table: every item Met except F3, which is
  correctly and deliberately deferred to a mandatory pre-merge human step
  (Task 37) — not a gap in this verification, and not something any
  verification or build agent should perform.
- Production DB (`/Users/sara/.claude/agent-dashboard/dashboard.db`) was not
  touched by any test invocation in this pass; its ongoing checksum/mtime
  drift is attributable to an unrelated, independently-running live dev
  server, consistent with both prior passes' findings.

No caveats. This effort is ready to proceed to the F3 manual double-boot
walkthrough and merge, contingent on that human-supervised step being
performed and passing its own Done-check.

---
---

# FOURTH-PASS VERIFICATION (post-review fixes)

**Verdict: GREEN**

This pass verifies the loop-back author's claimed fixes for the 3 blockers
(B1, B2, B3) and 9 should-fix items (S1-S9) surfaced by a separate,
adversarial code-review round after pass 3's GREEN. Every claim below was
independently re-derived from the code itself, not taken from the
implementer's self-report — including a from-scratch red-by-injection
reproduction for B3, matching the rigor of the injection proofs in passes 1-3.

## 1. B1 — `playbookStore.ts` `save()` calls the real resolver helpers

Read `client/src/lib/playbookStore.ts`'s `save()` (lines 186-226) directly.
Confirmed:

```js
mergePractice({
  ...optimistic,
  resolvedKind: resolveDraftKind(optimistic, kindOverride),
  resolvedSeverity: resolveDraftSeverity(optimistic, severityOverride),
});
```

This calls the file's own exported `resolveDraftKind`/`resolveDraftSeverity`
— no inline reimplementation of the `?? ` fallback formula remains. Traced
the semantics: `kindOverride`/`severityOverride` here are always fully
resolved (never `undefined` — `"kindOverride" in patch ? patch.kindOverride
: current.kindOverride`), so passing them as the `draft` argument makes
`resolveDraftKind`'s `chosen = draft !== undefined ? draft : kindOverride`
branch always take `chosen = kindOverride`, then apply `coerceKind(chosen) ??
kind` — i.e., the real enum-coercion fail-safe now runs on every optimistic
save, closing the exact gap the reviewer found (a stale/out-of-enum cached
value could no longer slip through a third hand-rolled copy of the formula).
**Confirmed fixed, not superficially.**

## 2. B2 — `PlaybookPage.tsx` preview cards route through the real resolver or the server's resolved field

Read both call sites (`client/src/pages/PlaybookPage.tsx:359` and `:469`).
Both now read:

```jsx
kind={kindDraft === undefined ? practice.resolvedKind : resolveDraftKind(practice, kindDraft)}
```

**Reasoned through staleness, per the instruction, rather than treating the
pattern-match as sufficient:**
- `kindDraft` is only ever set once the operator touches the selector
  (`setKindDraft` in `OverrideSelects`'s `onKind`), and is never reset back
  to `undefined` on a successful save (only `onReset`'s explicit button
  click sets it to `null`, not `undefined`). This means once touched, the
  card always takes the `resolveDraftKind(practice, kindDraft)` branch for
  the rest of that component's lifetime — `practice.resolvedKind` is never
  read in that state, so there's no way for it to show a stale value there;
  it's simply not consulted once a live draft exists.
- The `practice.resolvedKind` branch is only live while `kindDraft ===
  undefined`, i.e. before the operator has touched the selector at all. In
  that window, `practice` comes from `usePlaybookPractices()` →
  `playbookStore.getSnapshot()`, which is refreshed on every hydrate, PUT
  response (`mergePractice(result)` in `save()`'s `.then()`), and live WS
  push (`playbook_practice_config_updated`) — all of which write a freshly
  server-served `resolvedKind`. There is no code path where this branch is
  read against a stale value from a save this same component made, since by
  the time `kindDraft` would go back to `undefined` (it never does without a
  full remount), the card would already be on the `resolveDraftKind` branch.
- Conclusion: the fix genuinely closes the gap in both directions — the
  dead-payload problem (server's `resolvedKind`/`resolvedSeverity` now
  actually gets read, once, before any edit) and the correctness problem
  (once edited, the enum-coercion fail-safe formula, not a raw draft value,
  drives the preview) — with no observable staleness window introduced.
  **Confirmed fixed.**

## 3. B3 — `rebuildTableAtomically()`'s `execute()` try/catch/rollback, independently red-by-injection reproduced

Read `server/db.js` lines 1482-1509. Confirmed the shape matches the spec
exactly: `db.pragma("foreign_keys = OFF")` before a `try { execute(); } catch
(err) { if (db.inTransaction) { try { db.exec("ROLLBACK"); } catch {} }
console.error(...); return false; } finally { db.pragma("foreign_keys =
ON"); }` — never throws, rolls back only if a transaction is genuinely still
open, logs, returns `false` (skip, not brick).

Read the new red-first test, `describe("coach_observations rebuild
execute() failure handling (B3)", ...)` in
`server/__tests__/coach-observations-severity-rebuild.test.js` (lines
353-447). Its fixture (`buildLegacyDbNoKindCheck`) plants a row with a valid
`severity` (passes the WATCH-3 pre-flight scan, which only checks severity)
but an out-of-enum `kind` (`"bogus-kind-out-of-enum"`), which the real
`INSERT INTO coach_observations_new SELECT * FROM coach_observations`
genuinely violates via the new table's `kind` CHECK — a real,
un-mocked `SQLITE_CONSTRAINT_CHECK`, not a simulated/stubbed error. Assertions
cover: `doesNotThrow` on `require("../db")`, `dbModule.db.inTransaction ===
false` after the failure, the main table still lacking the CHECK (rebuild
genuinely didn't complete), no orphaned `_old`/`_new` tables, and the
offending row preserved byte-for-byte.

**I did not trust the implementer's self-reported red-first log. I
reproduced it myself, live:**
1. Saved a copy of `server/db.js` (md5 `e8549bd18...`).
2. Baseline: ran the B3 test file alone under an external
   `DASHBOARD_DB_PATH` safety net → **15/15 pass**.
3. Patched `db.js`, replacing the entire `try { execute(); } catch {...}
   finally {...}` block with a bare `execute(); db.pragma("foreign_keys =
   ON");` (functionally: try/catch removed).
4. Re-ran the same test file → **14/15 pass, 1 fail** — specifically the new
   B3 test, with `error: 'Got unwanted exception: db.js should not throw
   even when the rebuild's execute() fails mid-transaction (B3)', Actual
   message: "CHECK constraint failed: kind IN ('risk','info','good')", code:
   'SQLITE_CONSTRAINT_CHECK'` — the *exact* uncaught throw the fix is meant
   to prevent, and every other test in the file (T1a/T1b/T3a/T3b/T3d)
   remained green, confirming the injection was narrowly scoped.
5. Restored `db.js` from the saved copy; `diff`/`md5` confirmed
   byte-identical to the pre-injection state (`e8549bd18...` both before and
   after).
6. Re-ran the same test file post-restore → **15/15 pass again.**
7. `git diff --stat server/db.js` after the full cycle showed only the
   effort's real, intended diff (175 insertions / 2 deletions against
   master) — zero residue from my injection.

**B3 confirmed fixed, with an independently-reproduced, from-scratch
red-by-injection proof — not a re-read of the implementer's transcript.**

## 4. Should-fix spot-checks (S1, S2, S3, S5, S6, S8)

| # | Claim | Verified |
|---|---|---|
| S1 | WATCH-2 comment corrected | `PlaybookPage.tsx:47-52`'s `OverrideSelects` doc comment states the severity selector "has no visible effect anywhere in the product today." Cross-checked against `ObservationCard.tsx` — grepped for `severity`, found only a comment reference, no actual render of severity anywhere in that component. Comment is accurate. **Confirmed.** |
| S2 | `SEVERITY_SQL_LIST` hoisted to a single const | `server/db.js:1362`: `const SEVERITY_SQL_LIST = SEVERITY_VALUES.map((v) => \`'${v}'\`).join(",");`, reused at 3 call sites (1386, 1526, 1539) rather than recomputed inline each time. **Confirmed.** |
| S3 | tsconfig narrowed to `/// <reference types="node" />` instead of `"types": ["node"]` | `client/tsconfig.json` has no `"types"` key at all (checked directly); `client/src/lib/__tests__/playbookStore.test.ts` line 1 has `/// <reference types="node" />`. `@types/node` remains a devDependency (`client/package.json:32`, `^26.1.2`) so the directive resolves. This is narrower than pass 2's `"types": ["node"]` project-wide setting — re-confirmed (as in pass 2) that no Node globals leak into shipped browser code: `grep -rn "process\.env\.\|__dirname\|Buffer\." client/src --include="*.ts" --include="*.tsx" | grep -v __tests__` finds only a literal string `"__dirname"` inside a keyword list in `highlight.ts`, not a real usage. **Confirmed**, and confirmed narrower/safer than the prior approach. |
| S5 | Parity-fixture mapping now actually asserted, not just correctly hardcoded | `server/__tests__/playbook-resolver-parity.test.js`'s main test now asserts, before resolving each case, that the fixture's `catalogKind`/`catalogSeverity` field matches the real `PRACTICES` entry's `kind`/`defaultSeverity` for the practice id the ternary selects (`assert.equal(practice.kind, testCase.catalogKind, ...)` / same for severity) — a future catalog edit that silently desyncs the fixture would now fail loudly here instead of silently exercising the wrong baseline. **Confirmed.** |
| S6 | `doesNotThrow` scoping fixed | Same file's second test (`"coerces out-of-enum overrides..."`) now wraps only the resolver call itself in `assert.doesNotThrow(() => { resolved = resolvePracticeConfig(row, practice); })`; the subsequent `assert.equal(resolved.kind, practice.kind, ...)` runs outside the `doesNotThrow` callback, so a genuine assertion failure now reports as a normal equality mismatch instead of a misleading "Got unwanted exception." **Confirmed.** |
| S8 | In-place array mutation fixed to use a copy | Located precisely: `server/__tests__/coach-observations-severity-rebuild.test.js`'s T3d test (lines 844-872) now does `const registrySeverityValues = [...SEVERITY_VALUES].sort().join(",")` and `const registryKindValues = [...KIND_VALUES].sort().join(",")` — spread-copying before `.sort()`. Without the copy, `.sort()` would have mutated `practices.js`'s exported, module-singleton `SEVERITY_VALUES`/`KIND_VALUES` arrays **in place**, permanently reordering the actual arrays used by `coerceEnum()`/the route validator/the resolver for the rest of that process once this test ran — a real shared-mutable-state bug in a test file reaching into product-module internals, now closed by copying before sorting. (I swept every touched file for `.sort(`/`.push(`/`.splice(`/`Object.assign(` first and confirmed every other hit operates on a freshly-created, function-local array/object, not shared/module state, before concluding this was the intended item.) **Confirmed, and precisely located.** |

## 5. Full suites + build — run fresh by me

- **Server**: `DASHBOARD_DB_PATH=<scratch>.db node --test server/__tests__/*.test.js`
  → **1300 tests, 1300 pass, 0 fail** (314 suites) — matches the implementer's
  claim exactly, independently reproduced.
- **Client**: `cd client && npx vitest run` → **699 tests, 699 pass, 0 fail**
  (59 files) — matches the implementer's claim exactly.
- **Count drop from 701 (pass 3) to 699 investigated, not accepted at face
  value:** confirmed `client/src/lib/__tests__/playbookStore.test.ts` (the
  T8 client-half parity test) now has exactly 2 `it()` blocks — one looping
  over every case-table row with `catalogKind`, one over every row with
  `catalogSeverity` — rather than 4 separate blocks split by
  parity-applicable vs. draft-only rows (S7, "cleaned of duplication"). Read
  the loop bodies: each loop's filter (`"catalogKind" in c`/`"catalogSeverity"
  in c`) already covers both parity and draft-only rows in the shared fixture,
  so consolidating 4 blocks into 2 removed no case coverage, only redundant
  `it()` wrapper/boilerplate — confirmed by reading the full file, not
  inferred from the count alone. `PlaybookPage.test.tsx` unchanged at 15
  tests. This fully and exclusively accounts for 701 → 699; no lost
  assertions found anywhere else in the client suite.
- **Client build**: `cd client && rm -rf tsconfig.tsbuildinfo dist && npm run
  build` (forced clean rebuild) → **`tsc -b` and `vite build` both succeed,
  zero errors.** Same expected chunk-size-warning-only output as pass 3.

## 6. Production DB safety — re-confirmed

`/Users/sara/.claude/agent-dashboard/dashboard.db`'s checksum changed over
the course of this pass (as in all three prior passes), attributable to two
independently-running dev-server processes confirmed via `ps`/`lsof` to have
their `cwd` in `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor` (the
main repo checkout) — **not** this effort's worktree at
`/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-02-practice-kind-override/...`.
Confirmed the hash was stable across a 5-second idle window with no test
activity, and every test invocation in this pass used an explicit external
`DASHBOARD_DB_PATH` pointed at a disposable scratch file — none referenced
the production path. Same conclusion as passes 1-3, reached the same way,
not assumed.

## 7. Regression sweep across the rest of the diff

`git diff --stat` against the same base as prior passes shows the diff is
still scoped exactly to the practice-kind-override surface (21 modified
files + 6 new test/fixture files, all playbook/coach-related) — no
unrelated file was touched by this fix-review round. No new regression found
outside the specific B1/B2/B3/S1-S9 items reviewed above.

## Verdict

**GREEN.** All 3 blockers (B1, B2, B3) are genuinely fixed, independently
re-derived from source (not the self-report), with B3 additionally proven by
an independent, from-scratch red-by-injection cycle. All 6 spot-checked
should-fix items (S1, S2, S3, S5, S6, S8) match their specs exactly, with S8
precisely located (a shared-module-singleton mutation bug in a test file,
now fixed by copy-before-sort). Full server suite (1300/1300), full client
suite (699/699 — count change fully explained, no lost coverage), and a
forced-clean production build are all green, independently run. Production
DB integrity re-confirmed unaffected. No new regressions found anywhere else
in the diff.

This effort is ready for `build-lead` to write the final report, contingent
(as in pass 3) on the still-deliberately-deferred F3 manual double-boot
walkthrough (Task 37, mandatory pre-merge, human-supervised, not performed
by any verification or build agent).
