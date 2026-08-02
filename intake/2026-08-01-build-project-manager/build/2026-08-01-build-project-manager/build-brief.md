# Build Brief — build-project-manager (layers 4–6)

Slug: `2026-08-01-build-project-manager`
Prepared by: Build-Intake Clerk
Date: 2026-08-01

**STATUS: READY.**

## What we're building

The missing middle of this dashboard's confirmed 7-layer portfolio-management
architecture: **layer 5** (pace tracking — an optional `plan_items.target_date`
plus a single shared `pace.js` computation of `no_target`/`on_track`/`behind`/
`done`), **layer 4** (durable, queryable detour disposition —
`detour_dispositions` — that now culminates in **real write-back into
`AGENT-PLAN.md`** the instant a `fold_in`/`new_item` verdict is decided, per
Sara's own DEC-2/DEC-13 overrule of the team's advisory-only recommendation,
through one guarded path — `plan-writeback.applyDisposition` — that then
re-runs the ordinary `ingestPlanForCwd` so `plan_items` keeps exactly one
writer), and **layer 6** (an in-process `reconciliation.js` scheduler running
deterministic rules per cwd, escalating only what the rules flag to one
batched hermetic `claude -p` classification pass, with verdicts landing in a
new `decision_queue` readable over HTTP and `ccam`). Zero client changes; no
MCP surface. End state: three new DB objects, one new scheduler, three new
derivation libs, two new write-path libs, two new routes, two new `ccam`
commands, and a server test suite that — per this project's own QA
gap-closure — makes the write-sequence form of DERIVED-DUAL-VIEW and the
chronology-ordering guard mechanically enforced for the first time, not just
review-enforced.

## Plan sources

- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-01-build-project-manager/technical-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-01-build-project-manager/qa/test-plan.md`
- `/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor/intake/2026-08-01-build-project-manager/decisions.md` (full decision trail, read in full — includes DEC-2/DEC-13, Sara's two explicit overrules of the team's recommendation, and a 2026-08-01 verification log re-checking every citation against commit `3c2db7d`, which is this repo's current `HEAD`: **no drift found**)

Read all three in full. The test-plan's coverage maps directly onto the
technical-plan's change set — same three new libs (`pace.js`, `detours.js`,
`plan-writeback.js`/`atomic-file.js`, `reconciliation.js`), same schema
objects (`detour_dispositions`, `decision_queue`, `plan_items.target_date`),
same routes/CLI surfaces, and the same build order (Layer 5 → Layer 4 → Layer
6, DEC-3). No inconsistency found between them. The QA pass additionally
identified and the test-plan closes five must-add gaps (G1–G6, table in
`test-plan.md` "Coverage gap being closed") that the technical-plan's own
change set does not by itself guarantee: a real `ALTER TABLE` migration test,
a cross-call-site byte-parity test between the human-resolve route and the
reconciliation tick (§9.1's own acceptance criterion made executable), a
single-writer structural meta-test, full 5-of-5 chronology-ordering coverage,
and an automated backup-lands-on-disk check.

## Buildability check

- **Technical-plan**: concrete **Change set** (§3, file-by-file, all three
  layers) and concrete, sequenced **Implementation steps** (§4, steps 0–30+,
  each independently checkable, each layer gated on "show Sara" checkpoints
  per DEC-3). Not vague — buildable as written.
- **Test-plan**: names **specific spec files + assertions** for every new/
  extended surface (group A–E, 9 new files + 4 extended files, each with
  concrete red-before/green-after criteria) and an explicit **red-first**
  discipline stated project-wide ("every spec named below is red-by-
  construction today... each assertion is stated with the specific
  plausible-but-wrong implementation it fails against") plus a numbered
  Implementation steps section (1–23) sequenced to match the technical
  plan's own layer order.
- **Not blocked** on this axis.

## Repo layout

Confirmed via `PROJECT-CONTEXT.md` ("Repo topology" section) and independently
verified: `find <root> -maxdepth 2 -name .git` finds only the top-level
`.git`. **Single self-contained monorepo**, no sibling repos. Base/working
branch: `master` (`git symbolic-ref refs/remotes/origin/HEAD` →
`refs/remotes/origin/master`; local checkout was also on `master`). One repo
touched — this effort's whole change set (server libs/routes/db/tests, `bin/
ccam.js`, docs) lives in this one repo.

**Docker: confirmed not needed for this build's scope.** Three docker-compose
files exist at the project root/subdirectories (`docker-compose.yml`,
`docker-compose.full.yml`, `monitoring/docker-compose.yml`), but per this
repo's own `.claude/skills/devops/SKILL.md`, they describe the **containerized
production build** path (`docker-up`/`docker-down`, `node:22-alpine`,
`NODE_ENV=production`) — a separate, optional path from the native dev/test
loop (`web-setup`/`web-up`, Express+Vite). This build's own technical-plan and
test-plan verification path is exclusively `npm run test:server` (Node's
built-in test runner against a real SQLite file in a temp dir) — no browser
e2e, no containerized dependency named in either plan. `PROJECT-CONTEXT.md`
names no Docker-stack convention for this project. **Skipped.**

**Effort registry: none configured.** `PROJECT-CONTEXT.md` names no effort
registry for this project — step skipped, consistent with this project's two
prior triage passes (`2026-07-26-focus-calendar-board`,
`2026-07-31-focus-untracked-commits`).

## Safety gate

The main repo checkout
(`/Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor`) currently carries
pre-existing uncommitted work that is **explicitly out of scope** for this
build and was **not** touched, discarded, or carried into the effort's
worktree:

```
 M PROJECT-CONTEXT.md
 M client/src/components/Sidebar.tsx
 M client/src/components/__tests__/Sidebar.openTerminal.test.tsx
 M pm.md
?? intake/2026-08-01-build-project-manager/
```

(The `intake/2026-08-01-build-project-manager/` untracked directory is this
very effort's own intake artifacts — expected, not a defect. The other four
paths are unrelated in-flight work per the task brief and must stay in the
main checkout only.)

The worktree was created with `git worktree add <path> -b <branch> master` —
a checkout from the **branch ref/commit**, not from the main checkout's
dirty index or working tree — so none of the above uncommitted state could
have been carried over. Verified immediately after provisioning:

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor status --porcelain
(no output)
```

Clean. Re-checked the main checkout immediately after provisioning too — its
status is byte-identical to the pre-provisioning snapshot above, confirming
the worktree operation did not disturb it. **Verdict: clean. Proceeding.**

## Worktree set

| Repo | Worktree path | Branch | Type | Starting commit |
|---|---|---|---|---|
| Claude-Code-Agent-Monitor | `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor` | `effort/2026-08-01-build-project-manager` | new branch off `master` | `3c2db7df6d4337a45e9bbeb672319c47e3027650` |

- Base branch: `master`, HEAD at time of provisioning = `3c2db7d` (tip
  commit message: "feat(usage,sidebar): OAuth-based account credentials +
  terminal-focus open-terminal") — this is the exact commit `decisions.md`'s
  Verification log re-checked all plan citations against and found **no
  drift**, so the worktree's starting point matches the plans' own stated
  currency.
- Created via: `git -C /Users/sara/CODE-LOCAL/SARA/Claude-Code-Agent-Monitor
  worktree add
  /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor
  -b effort/2026-08-01-build-project-manager master`.
- Verified clean immediately after creation (see Safety gate above).
- No other repos exist under this project (confirmed by `PROJECT-CONTEXT.md`
  and by `find <root> -maxdepth 2 -name .git` finding only the top-level
  `.git`), so there are no "untouched repos" needing a base-HEAD-only
  worktree.
- Efforts convention: the shared sibling directory
  `/Users/sara/CODE-LOCAL/SARA/efforts/<slug>/<repo-name>`, one level above
  all repos under `~/CODE-LOCAL/SARA/` — the same convention this project's
  two prior triage passes established and used
  (`2026-07-26-focus-calendar-board`, `2026-07-31-focus-untracked-commits`).

## Docker stack

**Not provisioned** — see "Repo layout" above for the full reasoning
(production-only compose files per the devops skill; both plans verify
exclusively via `npm run test:server`). Same call this project's two prior
triage passes made, for the same reason, now additionally corroborated by
`.claude/skills/devops/SKILL.md`'s own description of the Docker path as the
containerized production build, separate from native dev.

## Surfaces touched

**Server — new files:**
- `server/lib/pace.js` — layer 5's single shared pace computation.
- `server/lib/atomic-file.js` — `atomicWriteFile` extracted verbatim from
  `server/lib/cc-mutate.js:218-247`.
- `server/lib/plan-writeback.js` — `sanitizeLlmPlanText`, `appendPlanItem`,
  `appendSubItem`, `applyDisposition`, `__injectPreRenameHookForTest`. **This
  is the highest-stakes new file in the effort** — it is the only path that
  writes real bytes into Sara's `AGENT-PLAN.md` unattended.
- `server/lib/detours.js` — `DISPOSITIONS` enum, `recordInferredDetour`,
  `backfillDeclaredDetours`, `resolveDisposition`.
- `server/lib/reconciliation.js` — the scheduler: `evaluateRules` (zero LLM
  calls) / `classifyFlaggedDetours` (LLM half) hybrid split.
- `server/routes/detours.js`, `server/routes/decision-queue.js` — new routes.

**Server — edited files:** `server/db.js` (3 new/extended schema blocks:
`plan_items.target_date` + migration, `detour_dispositions`,
`decision_queue`, all new prepared statements), `server/lib/plan-ingest.js`
(exports-only — `ID_LINE_RE`/`ACCEPTANCE_LINE_RE`/`DETAIL_LINE_RE`/
`LINE_SPLIT_RE`/`MAX_*` caps, plus its header's "dashboard never writes
AGENT-PLAN.md" claim, which is now false and must be corrected),
`server/lib/cc-mutate.js` (delete local `atomicWriteFile`, require the
extracted module instead), `server/lib/focus-inference.js` (one guarded
`try/catch` call to `recordInferredDetour` after the existing
`upsertFocusInference.run`), `server/routes/plans.js` (new
`POST /api/plans/items/target`), `server/index.js` (mount 2 new routers,
start the scheduler), `bin/ccam.js` (new `focus target` and `decisions`
commands across all three registration points — `COMMAND_GROUPS`,
`SUBCOMMANDS`, the handler), `server/openapi-extra/misc.js`.

**Server — new/extended tests:** 9 new spec files
(`pace-tracking.test.js`, `atomic-file.test.js`, `plan-writeback.test.js`,
`detour-disposition.test.js`, `reconciliation.test.js`,
`reconciliation-full-tick.test.js`, `db-migration.test.js`,
`single-writer-guard.test.js`, `chronology-ordering.test.js` +
`helpers/ordering.js`) and 4 extended files (`plan-ingest.test.js`,
`plans-api.test.js`, `focus-inference.test.js`, `ccam-cli.test.js`).

**Docs (end of change set, per this repo's `update-project-docs` trigger):**
`ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `server/README.md`
(including the mandatory correction of the "dashboard never writes
AGENT-PLAN.md" claim in `plan-ingest.js`'s own header and every downstream
repetition — DEC-8 item 4), plus `pm.md` close-out edits.

**No client changes** (`decisions.md` WATCH-3 — deliberate; layer 7's
portfolio-rollup UI is out of scope). `git status` on the effort worktree
must show zero client file changes attributable to this effort at close-out.

**Project-specific risk surfaces flagged, per `PROJECT-CONTEXT.md` §9:**
- **§9.1 DERIVED-DUAL-VIEW (write-path form, 5th occurrence, first time this
  entry is live/enforceable before a defect ships).** The catalog's own
  design-time pre-flag on this intake: pace status, disposition, and
  decision-queue entries are three new derived values introduced at once,
  each of which must be a single exported function on day one — and
  critically, the **write sequence itself** (`applyDisposition`) is the same
  shape of trap one layer over. QA's own gap-closure (G2, G3) targets exactly
  this: a cross-call-site byte-parity test (Scenario C,
  `reconciliation-full-tick.test.js`) and a structural meta-test
  (`single-writer-guard.test.js`) that a future third write-composer must
  fail against.
- **§9.2 row-id-as-chronology-proxy (4th discovery site if missed).** Layer
  4/6 add five new "recent N" queries over bulk-inserted tables
  (`listPendingDetours`, `listStaleResolvedDetours`, `listDecisionQueue`,
  `backfillDeclaredDetours`, and — the QA pass's own "worst" flag — layer 6's
  detour-volume-ratio lookback). All five must sort `created_at` (id
  tiebreak) **before** any `LIMIT`. QA's gap-closure (G4) is the first time
  all five get behavioural out-of-order coverage plus a static SQL-shape
  scan, closing the systemic cause (a hand-typed guarded-query list) the
  catalog's own QA-pass note names.

## Durable-cure obligations (MANDATORY)

1. **§9.1 DERIVED-DUAL-VIEW — write-sequence form must be structurally
   enforced, not reviewed.** `applyDisposition()` is the sole write-composer
   for both DEC-13 trigger points (human resolve route, reconciliation tick).
   `single-writer-guard.test.js` (test-plan step 9, built *before*
   `plan-writeback.js` exists) and Scenario C's cross-call-site byte-parity
   test (test-plan step 19, `reconciliation-full-tick.test.js`) are both
   Definition-of-Done items (G2, G3) — not optional. If either is cut, per
   `decisions.md` WATCH-11's own instruction, WATCH-11 must be reopened as
   "PENDING, mitigation not yet designed" in the same commit.
2. **§9.2 row-id-as-chronology-proxy — all 5 new queries, not 2.** Every
   query enumerated above must sort `ORDER BY created_at …, id …` before any
   `LIMIT`, proven via the shared `assertOrderedByCreatedAt` helper
   (`chronology-ordering.test.js`, test-plan step 15) plus the static
   SQL-shape scan with a frozen `GRANDFATHERED_QUERIES` set. This is G4 in
   the Definition of Done — the detour-volume lookback case in particular is
   flagged worst-first because a chronology bug there flags the *wrong
   sessions* while the suite stays green.
3. **DEC-10 override — do not implement the engineer's `target:` line
   parser.** `target_date` is authored strictly out-of-band
   (`POST /api/plans/items/target` + `ccam focus target`), never added to
   `upsertPlanItem`'s `SET` clause. `plan-ingest.js` gains **exports only**.
4. **DEC-14 — one write path, one composer, one set of column names.** The
   forward pointer is `resolved_item_id` (holding `plan_items.item_id`), not
   `linked_plan_item_id`/an integer PK. The lifecycle vocabulary is
   `disposition` + `write_status` + `resolved_at`. `buildPlanSnippet()` is
   dropped from the change set. Losing spellings must not appear in the code
   (test-plan step 21's grep gates).
5. **DEC-15 — both new tables land their full final shape in the initial
   `CREATE TABLE`**, including `detour_dispositions`'s write-audit columns
   and `decision_queue.kind`'s widened `CHECK` — SQLite cannot `ALTER … ADD
   COLUMN` a `CHECK` in place, so shipping the base table first costs a full
   rename-copy-drop rebuild later (WATCH-4).
6. **File-header compliance.** Every new/edited applicable source file
   (8+ new `.js` files, per test-plan step 20) must carry the mandatory
   `@author Son Nguyen <hoangson091104@gmail.com>` header per
   `.claude/rules/file-headers.md`; verify with
   `bash .claude/skills/file-headers/scripts/check-headers.sh`.
7. **DEC-7 live-trial gate — not automatable, not optional.** A green
   `npm run test:server` is explicitly **not** sign-off. Per DEC-13's
   widened scope, Sara must review real decision-queue output *and* the
   actual unattended text written into her real `AGENT-PLAN.md` files
   against her real fleet, and confirm backups are landing under
   `<cwd>/.claude/agent-plan-backups/`, before this build is considered done.
8. **DEC-12 residue must be deleted, not left passing.** Any stale
   `plan_items row count is unchanged` assertion tied to `fold_in`/`new_item`
   (written under the now-superseded advisory-only design) must be removed —
   a stale copy passing silently would mean the two dispositions are, in
   practice, writing nothing. Test-plan step 21's grep gate checks this.
9. **Docs correction, not just addition (DEC-8 item 4).** `plan-ingest.js`'s
   own header currently states the dashboard never writes `AGENT-PLAN.md`.
   That claim, and every downstream repetition in `ARCHITECTURE.md`,
   `docs/API.md`, `docs/DATABASE.md`, `server/README.md`, must be corrected
   to the accurate form — the file is still human-owned and the single
   source of truth; the dashboard now appends through one audited path and
   reads it back through the same ingest as always.

## Back-out command(s)

```
git -C /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-01-build-project-manager/Claude-Code-Agent-Monitor reset --hard 3c2db7df6d4337a45e9bbeb672319c47e3027650
```

## Open questions

**BLOCKING:** none.

**Non-blocking (assumption stated):**

1. **Docker non-provisioning** — assumption stated above (production-style
   compose files, confirmed by this repo's own devops skill as a separate
   path from native dev/test, not part of either plan's verification loop).
   If a later build step turns out to need a running dashboard container for
   some reason not visible in either plan, flag it and Docker can be
   provisioned at that point.
2. **Effort registry / Docker stack are both project-level "not configured"
   calls**, consistent with this project's two prior triage passes — not a
   fresh judgment call unique to this effort.
3. **`decisions.md`'s two PENDING/accepted-risk rows (WATCH-8 backup
   retention, WATCH-9 residual TOCTOU window, WATCH-10 single-instance mutex
   assumption) are pre-accepted by Sara/tech-lead in the decision trail**,
   not reopened by this triage pass — they are the implementer's and DEC-7's
   live-trial gate's concern at build/verification time, not a blocker to
   starting.
4. **DEC-7's live-trial gate (item 7 above) cannot be satisfied by this
   build-triage pass or by an automated test run** — flagging explicitly so
   the build team does not mistake a green `npm run test:server` for
   sign-off, per the technical-plan's and test-plan's own repeated framing.
