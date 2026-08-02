# Unit / Parity Test Design — practice-kind-override

> Authored by `qa-unit-architect`. Designs the fast, deterministic-layer tests
> for `intake/2026-08-02-practice-kind-override/technical-plan.md`. This is
> pre-build (per `qa/change-brief.md`) — every file below is confirmed to
> exist (and its current shape re-read) except where marked **new file**.
> Test stack (confirmed from `package.json`): server = `node:test` +
> `node:assert/strict` via `npm run test:server`; client = Vitest + Testing
> Library via `npm run test:client`; both via root `npm test`.

Grounding: the canonical single-source-of-truth this build introduces is
`resolvePracticeConfig()` in `server/lib/playbook/practices.js`
(confirmed current shape at lines 91-117 — pre-build it resolves only
`{enabled, config}`; post-build widens to
`{ enabled, config, kindOverride, severityOverride, catalogKind,
catalogSeverity, kind, severity }`). Every test below asserts a consumer
agrees with *that* function's output — never with a hand-rolled copy.

---

## 1. Frozen-snapshot regression test (load-bearing)

**File:** `server/__tests__/playbook.test.js`, inside the existing
`describe("playbook engine")` block (confirmed at line 18), placed
immediately after the existing
`"respects a raised account-weekly-balance gap threshold override"` case
(line 204) per the technical plan §6.1.

Both new test cases use `dbModule.stmts.upsertPlaybookPracticeConfig.run(...)`
to write overrides (existing helper, confirmed at `server/db.js:1855`) and
`dbModule.stmts.getCoachObservation.get(id)` (confirmed at
`server/db.js:1867`) to re-fetch prior rows without going through the
engine — the whole point being that a later engine action must not touch
them.

**Do not copy QA's `supporting/qa.md` §3a snippet verbatim** — it uses a
nested `config.kind` key; the real persisted key is the top-level-in-the-JSON-blob
`kindOverride` (Override 3, confirmed by `technical-plan.md` §2.2).

### 1a. Global scope — `account-weekly-balance`

**Test name:** `"freezes kind/severity onto each Observation at fire time; a later override change never relabels an earlier row (account-weekly-balance, global scope)"`

```js
it("freezes kind/severity onto each Observation at fire time; a later override change never relabels an earlier row (account-weekly-balance, global scope)", () => {
  seedAccount("acct-a", "Personal", 80);
  seedAccount("acct-b", "Work", 40);

  // Step 1 — no override: catalog values.
  const first = engine.tick(dbModule).find((o) => o.practice_id === "account-weekly-balance");
  assert.ok(first, "expected account-weekly-balance to fire");
  assert.equal(first.kind, "info");       // PRACTICES[account-weekly-balance].kind
  assert.equal(first.severity, "info");   // PRACTICES[account-weekly-balance].defaultSeverity
  dbModule.stmts.updateCoachObservationStatus.run("dismissed", first.id); // allow refire

  // Step 2 — set an override, tick again: the NEW row gets it.
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    "account-weekly-balance",
    1,
    JSON.stringify({ gapThresholdPct: 25, kindOverride: "risk", severityOverride: "warning" })
  );
  const second = engine.tick(dbModule).find((o) => o.practice_id === "account-weekly-balance");
  assert.ok(second, "expected a refire after the override was set");
  assert.equal(second.kind, "risk");
  assert.equal(second.severity, "warning");

  // The EARLIER row is byte-unchanged — re-fetched directly, not from the tick's return value.
  const firstReread = dbModule.stmts.getCoachObservation.get(first.id);
  assert.equal(firstReread.kind, "info");
  assert.equal(firstReread.severity, "info");
  assert.equal(firstReread.status, "dismissed");        // updateCoachObservationStatus touched only this
  assert.ok(firstReread.responded_at, "responded_at should be set, but kind/severity must not be");

  dbModule.stmts.updateCoachObservationStatus.run("dismissed", second.id);

  // Step 3 — change/clear the override again, tick a third time: BOTH prior rows still frozen.
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    "account-weekly-balance",
    1,
    JSON.stringify({ gapThresholdPct: 25, kindOverride: "good", severityOverride: "info" })
  );
  const third = engine.tick(dbModule).find((o) => o.practice_id === "account-weekly-balance");
  assert.equal(third.kind, "good");
  assert.equal(third.severity, "info");

  const firstAgain = dbModule.stmts.getCoachObservation.get(first.id);
  const secondAgain = dbModule.stmts.getCoachObservation.get(second.id);
  assert.equal(firstAgain.kind, "info");
  assert.equal(firstAgain.severity, "info");
  assert.equal(secondAgain.kind, "risk");
  assert.equal(secondAgain.severity, "warning");
});
```

### 1b. Session scope — `session-token-ceiling` (the sibling call site — not optional)

Catalog values for `session-token-ceiling` are `kind: "risk"`,
`defaultSeverity: "warning"` (confirmed, `practices.js:29-30`) — pick override
values that are *provably different* from catalog (`good`/`info`) so a test
that accidentally reads the catalog value instead of the resolved one cannot
pass by coincidence.

**Test name:** `"freezes kind/severity onto each Observation at fire time; a later override change never relabels an earlier row (session-token-ceiling, session scope)"`

```js
it("freezes kind/severity onto each Observation at fire time; a later override change never relabels an earlier row (session-token-ceiling, session scope)", () => {
  seedSession("sess-1");
  seedTokens("sess-1", 150_000_000);

  const first = engine.tick(dbModule)[0];
  assert.equal(first.kind, "risk");
  assert.equal(first.severity, "warning");
  dbModule.stmts.updateCoachObservationStatus.run("dismissed", first.id);

  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    "session-token-ceiling",
    1,
    JSON.stringify({ thresholdTokens: 100_000_000, kindOverride: "good", severityOverride: "info" })
  );
  const second = engine.tick(dbModule)[0];
  assert.equal(second.kind, "good");
  assert.equal(second.severity, "info");

  const firstReread = dbModule.stmts.getCoachObservation.get(first.id);
  assert.equal(firstReread.kind, "risk");
  assert.equal(firstReread.severity, "warning");

  dbModule.stmts.updateCoachObservationStatus.run("dismissed", second.id);

  // Clear the override entirely -> back to catalog default.
  dbModule.stmts.upsertPlaybookPracticeConfig.run(
    "session-token-ceiling",
    1,
    JSON.stringify({ thresholdTokens: 100_000_000 })   // no kindOverride/severityOverride key at all
  );
  const third = engine.tick(dbModule)[0];
  assert.equal(third.kind, "risk");
  assert.equal(third.severity, "warning");

  const firstAgain = dbModule.stmts.getCoachObservation.get(first.id);
  const secondAgain = dbModule.stmts.getCoachObservation.get(second.id);
  assert.equal(firstAgain.kind, "risk");
  assert.equal(firstAgain.severity, "warning");
  assert.equal(secondAgain.kind, "good");
  assert.equal(secondAgain.severity, "info");
});
```

**Why both, not one:** §9.4 FIX-ROUND-REGRESSION — `evaluateSession()` and
`evaluateGlobal()` are two independent `insertCoachObservation.run(...)` call
sites (`engine.js:93-100` and `:141-147`). A green test on 1a proves nothing
about 1b, and vice versa — this is literally the plan's stated risk R2.

**Test data / fixtures:** reuses the file's own existing `seedSession`,
`seedTokens`, `seedAccount` helpers (confirmed at lines 42-76) — no new
fixtures needed. Each `it` gets a fresh temp DB via the file's existing
`beforeEach`/`afterEach` (lines 23-40).

**Red-first proof (§9.3), required before either test counts:** run both
against the pre-build tree. They **must fail** — pre-build,
`resolvePracticeConfig()` never returns `kind`/`severity` at all, and
`engine.js` writes the bare `practice.kind`/`practice.defaultSeverity`
catalog constants (confirmed `engine.js:97-98`, `:145-146`), so `second.kind`
will read `"info"`/`"risk"` (the catalog value) instead of the overridden
`"risk"`/`"good"` — the assertion on `second.kind`/`second.severity` is what
fails. Record in the PR/commit message that this was observed red before the
resolver/engine changes landed, per §9.3's "a guard with no recorded red
state is not a guard" (this is a regression test, not a structural guard, but
the same discipline applies per the change-brief's explicit call-out).

**Additional required assertion (per change-brief's checklist item (d)):**
add a standalone case —

**Test name:** `"updateCoachObservationStatus never touches kind or severity"`
```js
it("updateCoachObservationStatus never touches kind or severity", () => {
  seedSession("sess-1");
  seedTokens("sess-1", 150_000_000);
  const [obs] = engine.tick(dbModule);
  dbModule.stmts.updateCoachObservationStatus.run("acknowledged", obs.id);
  const reread = dbModule.stmts.getCoachObservation.get(obs.id);
  assert.equal(reread.kind, obs.kind);
  assert.equal(reread.severity, obs.severity);
  assert.equal(reread.status, "acknowledged");
});
```
This is cheap (already implicitly proven by 1a/1b's `status`/`responded_at`
assertions) but the brief names it as its own checklist item, so give it its
own named, greppable test rather than relying on inference from the bigger
tests.

---

## 2. Structural resolver-guard test (must be proven red first)

**File:** `server/__tests__/playbook-resolver-guard.test.js` — **new file**,
modeled directly on `server/__tests__/single-writer-guard.test.js` (confirmed
present, fs-walk + regex + explicit allowlist + actionable failure message
shape, `describe("Single-writer structural guard (§9.1 DERIVED-DUAL-VIEW)")`).

One structural difference from the precedent: the precedent's `scanFiles()`
only walks `.js` files (fine for `server/`), but assertion 3 below must also
walk `.tsx`/`.ts` under `client/src`. Extend the walker to accept a list of
extensions rather than writing a second copy:

```js
function scanFiles(dir, pattern, extensions = [".js"]) {
  const results = [];
  const excludeDirs = ["node_modules", "dist", "__tests__", "test"];
  function walk(current) {
    for (const entry of fs.readdirSync(current)) {
      if (excludeDirs.includes(entry)) continue;
      const fullPath = path.join(current, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) walk(fullPath);
      else if (extensions.some((ext) => entry.endsWith(ext))) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (pattern.test(content)) results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results.sort();
}
```
(Confirmed no `.test.ts`/`.test.tsx` files live outside `__tests__` dirs in
`client/src` today — the extension check alone won't accidentally sweep in a
sibling `PlaybookPage.test.tsx`; the `__tests__` dir exclusion is the
belt-and-suspenders that also matters for the `client/src` walk.)

`describe("Single-resolver structural guard (§9.1 DERIVED-DUAL-VIEW, this practice's effective kind/severity)")`:

### 2a. Server, strict

**Test name:** `"practice.kind / practice.defaultSeverity are read raw only inside server/lib/playbook/practices.js"`
```js
it("practice.kind / practice.defaultSeverity are read raw only inside server/lib/playbook/practices.js", () => {
  const pattern = /practice\.kind\b|practice\.defaultSeverity\b/;
  const files = scanFiles(path.resolve(__dirname, ".."), pattern, [".js"]);
  const prodFiles = files.filter((f) => !f.includes("__tests__"));
  const basenames = prodFiles.map((f) => path.basename(f));
  assert.deepEqual(
    basenames,
    ["practices.js"],
    `practice.kind/practice.defaultSeverity must be read raw only in practices.js (the resolver). ` +
      `Found also in: ${basenames.filter((b) => b !== "practices.js").join(", ")}`
  );
});
```

### 2b. Engine, sharpest (named separately per the plan so the failure message is unambiguous)

**Test name:** `"engine.js contains zero raw practice.kind / practice.defaultSeverity reads — both evaluateSession() and evaluateGlobal() must read the resolved value (§9.4)"`
```js
it("engine.js contains zero raw practice.kind / practice.defaultSeverity reads — both evaluateSession() and evaluateGlobal() must read the resolved value (§9.4)", () => {
  const enginePath = path.resolve(__dirname, "../lib/playbook/engine.js");
  const content = fs.readFileSync(enginePath, "utf8");
  const matches = content.match(/practice\.kind\b|practice\.defaultSeverity\b/g) || [];
  assert.equal(
    matches.length,
    0,
    "engine.js must not read practice.kind/practice.defaultSeverity directly in either " +
      "evaluateSession() or evaluateGlobal() — both call sites must destructure the resolved " +
      "{ kind, severity } already flowing through resolveEnabledPractices(). See §9.4 FIX-ROUND-REGRESSION."
  );
});
```

### 2c. Client display path

**Test name:** `"client/src reads practice.kind / practice.defaultSeverity nowhere but types.ts's interface declaration"`
```js
it("client/src reads practice.kind / practice.defaultSeverity nowhere but types.ts's interface declaration", () => {
  const pattern = /practice\.kind\b|practice\.defaultSeverity\b/;
  const clientDir = path.resolve(__dirname, "../../client/src");
  const files = scanFiles(clientDir, pattern, [".ts", ".tsx"]);
  const prodFiles = files.filter((f) => !f.includes("__tests__"));
  const basenames = prodFiles.map((f) => path.basename(f));
  assert.deepEqual(
    basenames,
    ["types.ts"],
    `practice.kind/practice.defaultSeverity must appear only in types.ts's interface. ` +
      `Found also in: ${basenames.filter((b) => b !== "types.ts").join(", ")} — a preview card is ` +
      `hardcoding the catalog value again instead of the resolved draft value.`
  );
});
```

**Test data / fixtures:** none — this is a pure source-scan, no DB/fixtures.

### Red-first proof (§9.3 VACUOUS-GUARD) — mandatory, exact procedure

Do this once, immediately before the guard is considered done, and record it
in the PR/commit message (per the plan's own instruction):

1. With the resolver/engine/route/client changes already landed (so 2a/2c
   pass), temporarily add one line inside `evaluateSession()` in
   `engine.js` — e.g. `const rogue = practice.kind;` — and run
   `node --test server/__tests__/playbook-resolver-guard.test.js`. **Test
   2b must fail**, naming `engine.js`. Remove the line.
2. Temporarily add a rogue raw read into a client card — e.g. inside
   `SessionTokenCeilingCard` in `PlaybookPage.tsx`, add
   `const rogue = practice.kind;` — and run
   `cd client && npx vitest run` is not what scans this (the guard test is a
   server-side `node:test` file that walks `client/src` as plain text, so no
   client build step is needed); run
   `node --test server/__tests__/playbook-resolver-guard.test.js` again.
   **Test 2c must fail**, naming `PlaybookPage.tsx`. Remove the line.
3. Re-run the file once more; both must be green with the rogue reads
   removed. Byte-diff (`git diff`) to confirm the working tree is back to the
   real, non-rogue state before committing.
4. Note in the commit message: "playbook-resolver-guard.test.js proven red by
   injecting a rogue `practice.kind` reader into `engine.js`'s
   `evaluateSession()` and into `PlaybookPage.tsx`'s
   `SessionTokenCeilingCard`; both assertions failed as expected; reverted."

Without this recorded red state, per §9.3 the guard "protects nothing" even
though it is green.

**Cheap sweep before declaring done (per §9.3's own checklist):**
`grep -rn "assert.ok(true" server/__tests__/playbook-resolver-guard.test.js`
and `grep -rn "|| true" server/__tests__/playbook-resolver-guard.test.js`
must both return 0 — this new file should never need either idiom given the
`assert.deepEqual`/`assert.equal(matches.length, 0, …)` shapes above.

---

## 3. Two-validator lockstep test

Both directions of the hazard the Engineer flagged (§2.2 Override 1's "What
this does NOT change" note; `resolvePracticeConfig()` and
`validateOverridePatch()` are two separate functions and can drift in
opposite directions) need coverage, but the load-bearing one — per the
change-brief's explicit instruction — is the **"saved but never applied"**
direction, since that one 200s and looks fine on a shallow smoke test.

**File:** `server/__tests__/playbook.test.js`, inside the existing
`describe("PUT /api/playbook/practices/:id/config")` block (confirmed at
line 313), added after the existing
`"persists an account-weekly-balance gap-threshold override"` case (line 356).

### 3a. The load-bearing direction — "saved but never applied"

**Test name:** `"persists a kind override end-to-end: PUT succeeds AND a follow-up GET shows resolvedKind actually changed"`
```js
it("persists a kind override end-to-end: PUT succeeds AND a follow-up GET shows resolvedKind actually changed", async () => {
  const putRes = await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: "risk",
  });
  assert.equal(putRes.status, 200);
  assert.equal(putRes.body.kindOverride, "risk");
  assert.equal(putRes.body.resolvedKind, "risk");
  assert.equal(putRes.body.kind, "info", "catalog kind must still report the built-in, unchanged meaning");

  const getRes = await get("/api/playbook/practices");
  const practice = getRes.body.practices.find((p) => p.id === "account-weekly-balance");
  assert.equal(practice.kindOverride, "risk");
  assert.equal(practice.resolvedKind, "risk", "GET must independently reflect the applied override — this is the assertion that catches 'PUT 200s but no read path applies it'");

  // restore for later tests
  await put("/api/playbook/practices/account-weekly-balance/config", { kindOverride: null });
});
```

**Why a GET is required, not just checking the PUT response body:** the PUT
handler's response is `serializePractice(practice)` — the same function GET
calls. If only the PUT response were checked, a bug where the route
constructs its response from the raw request body (echoing back what was
sent) rather than actually persisting-then-re-resolving could pass a
PUT-only test while `resolvePracticeConfig()` never even runs. The follow-up
`GET` forces a full round trip through storage.

### 3b. Reject direction (both fields, both invalid)

**Test name:** `"400s on an invalid kindOverride value"` / `"400s on an invalid severityOverride value"`
```js
it("400s on an invalid kindOverride value", async () => {
  const res = await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: "not-a-kind",
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "INVALID_CONFIG");
});

it("400s on an invalid severityOverride value (pinned to exactly info/warning — proves 'critical' etc. is rejected)", async () => {
  const res = await put("/api/playbook/practices/account-weekly-balance/config", {
    severityOverride: "critical",
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "INVALID_CONFIG");
});
```

### 3c. Clear-to-default

**Test name:** `"clearing a kind override reverts resolvedKind to the catalog default"`
```js
it("clearing a kind override reverts resolvedKind to the catalog default", async () => {
  await put("/api/playbook/practices/account-weekly-balance/config", { kindOverride: "risk" });
  const res = await put("/api/playbook/practices/account-weekly-balance/config", { kindOverride: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.kindOverride, null);
  assert.equal(res.body.resolvedKind, res.body.kind);
});
```

### 3d. Partial-patch discipline (Architect risk #4 — the regression that silently eats every save)

**Test name:** `"a numeric-only config PUT does not clear an existing kind override"`
```js
it("a numeric-only config PUT does not clear an existing kind override", async () => {
  await put("/api/playbook/practices/account-weekly-balance/config", { kindOverride: "risk" });
  const res = await put("/api/playbook/practices/account-weekly-balance/config", {
    config: { gapThresholdPct: 30 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.kindOverride, "risk", "an unrelated numeric-field save must not reset the override");
  assert.equal(res.body.resolvedKind, "risk");

  // restore for later tests
  await put("/api/playbook/practices/account-weekly-balance/config", {
    kindOverride: null,
    config: { gapThresholdPct: 25 },
  });
});
```

### 3e. Cross-practice isolation

**Test name:** `"overriding one practice's kind does not affect another practice"`
```js
it("overriding one practice's kind does not affect another practice", async () => {
  await put("/api/playbook/practices/account-weekly-balance/config", { kindOverride: "risk" });
  const res = await get("/api/playbook/practices");
  const ceiling = res.body.practices.find((p) => p.id === "session-token-ceiling");
  assert.equal(ceiling.kindOverride, null);
  assert.equal(ceiling.resolvedKind, ceiling.kind);
  await put("/api/playbook/practices/account-weekly-balance/config", { kindOverride: null });
});
```

### 3f. Existing unmodified-validator regression

The existing case `"400s on an unknown config field"` (line 340) must still
pass unchanged after this build — `validateConfigPatch()` is explicitly
**not** modified (Override 1). No new test needed here; call this out in the
PR description as a "must still be green, unedited" check rather than adding
a redundant assertion.

**Test data / fixtures:** reuses the file's own `describe("playbook + coach
routes")` HTTP harness (`get`/`put`/`post` helpers, real `createApp()` +
`startServer()` against a throwaway `TEST_DB`, confirmed lines 231-292) — no
new fixtures.

**Red-first note:** 3a is the one that must be shown failing pre-build (route
has no `kindOverride` concept at all, so `putRes.body.kindOverride` is
`undefined`, not `"risk"`). 3b/3d are also naturally red pre-build for the
same reason (`INVALID_CONFIG`/`kindOverride` don't exist yet). Because these
are new-behavior tests rather than guards against a regression in existing
behavior, "red before, green after" is inherent to writing them against
pre-build code — no separate red-state ritual is needed beyond running them
once before the route change lands.

---

## 4. DB migration test

**Files:**
- `server/__tests__/db-migration.test.js` — per the technical plan's stated
  file location (Override 2 / §6.4), add a **new `describe` block**,
  `describe("Migration: coach_observations severity CHECK rebuild")`. **Do
  not** add an entry to `UPGRADE_CASES` or `GRANDFATHERED` (per the plan's
  explicit instruction) — `UPGRADE_CASES`'s shape (`legacySql` +
  `ALTER TABLE … ADD COLUMN` assertions) and the meta-test's regex
  (`ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN`, confirmed at line 720) are built
  for single-column additions, not a rename→recreate→copy→drop rebuild —
  forcing this into that shape would either not compile or make the meta-test
  falsely believe it's covered.
- **Mechanically, model the block on
  `server/__tests__/agents-legacy-rebuild.test.js`** (confirmed present) —
  that file is the actual precedent for this exact migration shape (a
  pre-existing `CHECK` too restrictive to `ALTER`, rebuilt via
  rename→recreate→copy→drop), not the `UPGRADE_CASES` entries, which are all
  plain `ADD COLUMN`s. Hand-build a legacy DB with `better-sqlite3` directly
  (no `db.js` involved yet), then `require("../db")` and assert against the
  live module — same two-phase shape `agents-legacy-rebuild.test.js` uses.

### 4a. Normal upgrade path (2 rows, both in-enum)

**Setup (`before`):** hand-build a temp DB with the **legacy** `coach_observations`
shape (`severity TEXT NOT NULL`, no `CHECK`, confirmed as today's shape at
`server/db.js:1373`) plus both indexes, and seed two rows — one
`severity='info'`, one `severity='warning'` — with distinct `practice_id`,
`scope_type`/`scope_id`, `values_json`, `status` (one `'open'`, one
`'dismissed'` with a non-null `responded_at`), and known `id`s, so
"byte-identical" is checkable across every column, not just `severity`.

```js
describe("Migration: coach_observations severity CHECK rebuild", () => {
  let tempDbPath;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `db-migration-coach-obs-test-${Date.now()}.db`);
    const raw = new Database(tempDbPath);
    raw.pragma("journal_mode = WAL");
    raw.exec(`
      CREATE TABLE coach_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        practice_id TEXT NOT NULL,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('session','project','global')),
        scope_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('risk','info','good')),
        severity TEXT NOT NULL,
        values_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','dismissed','resolved')),
        detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        responded_at TEXT
      );
      CREATE INDEX idx_coach_observations_open ON coach_observations (practice_id, scope_type, scope_id, status);
      CREATE INDEX idx_coach_observations_detected_at ON coach_observations (detected_at DESC);
    `);
    raw.prepare(`INSERT INTO coach_observations
      (id, practice_id, scope_type, scope_id, kind, severity, values_json, status, detected_at, responded_at)
      VALUES (1, 'session-token-ceiling', 'session', 'sess-legacy', 'risk', 'warning', '{"a":1}', 'open', '2026-07-01T00:00:00.000Z', NULL)`).run();
    raw.prepare(`INSERT INTO coach_observations
      (id, practice_id, scope_type, scope_id, kind, severity, values_json, status, detected_at, responded_at)
      VALUES (2, 'account-weekly-balance', 'global', NULL, 'info', 'info', '{"b":2}', 'dismissed', '2026-07-02T00:00:00.000Z', '2026-07-02T01:00:00.000Z')`).run();
    raw.close();
  });

  after(() => {
    process.env.DASHBOARD_DB_PATH = originalDbPath;
    delete require.cache[require.resolve("../db")];
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(`${tempDbPath}${suffix}`, { force: true }); } catch { /* best effort */ }
    }
  });

  it("loads db.js against the legacy DB without throwing", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];
    assert.doesNotThrow(() => require("../db"));
  });

  it("adds CHECK(severity IN ...) to coach_observations", () => {
    const { db } = require("../db");
    const meta = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'").get();
    assert.ok(meta.sql.includes("CHECK(severity IN"), `expected the CHECK in the rebuilt schema; got: ${meta.sql}`);
  });

  it("every pre-existing row survives byte-identical, including id", () => {
    const { db } = require("../db");
    const row1 = db.prepare("SELECT * FROM coach_observations WHERE id = 1").get();
    const row2 = db.prepare("SELECT * FROM coach_observations WHERE id = 2").get();
    assert.equal(row1.kind, "risk");
    assert.equal(row1.severity, "warning");
    assert.equal(row1.scope_id, "sess-legacy");
    assert.equal(row1.values_json, '{"a":1}');
    assert.equal(row1.status, "open");
    assert.equal(row1.responded_at, null);
    assert.equal(row2.kind, "info");
    assert.equal(row2.severity, "info");
    assert.equal(row2.status, "dismissed");
    assert.equal(row2.responded_at, "2026-07-02T01:00:00.000Z");
  });

  it("recreates both idx_coach_observations_open and idx_coach_observations_detected_at", () => {
    const { db } = require("../db");
    for (const name of ["idx_coach_observations_open", "idx_coach_observations_detected_at"]) {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
      assert.ok(idx, `expected ${name} to exist after the rebuild`);
    }
  });

  it("the new CHECK rejects an out-of-enum severity insert", () => {
    const { db } = require("../db");
    assert.throws(() => {
      db.prepare(
        `INSERT INTO coach_observations (practice_id, scope_type, scope_id, kind, severity, values_json)
         VALUES ('session-token-ceiling', 'session', 'x', 'risk', 'critical', '{}')`
      ).run();
    }, /CHECK constraint failed|SQLITE_CONSTRAINT/);
  });

  it("a second require is a no-op — idempotent, no duplicate rebuild, rows unchanged", () => {
    delete require.cache[require.resolve("../db")];
    require("../db");
    const raw2 = new Database(tempDbPath);
    const count = raw2.prepare("SELECT COUNT(*) AS n FROM coach_observations").get().n;
    assert.equal(count, 2, "row count must be unchanged after a second boot");
    const row1 = raw2.prepare("SELECT * FROM coach_observations WHERE id = 1").get();
    assert.equal(row1.severity, "warning");
    raw2.close();
  });
});
```

### 4b. Pre-flight-skip path (WATCH-3 — a separate `describe` with its own legacy DB)

**Test name:** `"skips the rebuild (does not throw, does not rewrite) when an out-of-enum severity value already exists"`

**Setup:** a second, independent legacy DB seeded with **three** rows, one of
them `severity='critical'` (a value outside `{'info','warning'}` — simulating
an install that predates this build's enum pin).

```js
describe("Migration: coach_observations severity CHECK rebuild — pre-flight skip (WATCH-3)", () => {
  let tempDbPath;
  const originalDbPath = process.env.DASHBOARD_DB_PATH;

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `db-migration-coach-obs-skip-test-${Date.now()}.db`);
    const raw = new Database(tempDbPath);
    raw.pragma("journal_mode = WAL");
    raw.exec(/* same legacy CREATE TABLE + indexes as 4a */);
    raw.prepare(`INSERT INTO coach_observations
      (id, practice_id, scope_type, scope_id, kind, severity, values_json, status, detected_at)
      VALUES (1, 'session-token-ceiling', 'session', 's1', 'risk', 'warning', '{}', 'open', '2026-06-01T00:00:00.000Z')`).run();
    raw.prepare(`INSERT INTO coach_observations
      (id, practice_id, scope_type, scope_id, kind, severity, values_json, status, detected_at)
      VALUES (2, 'account-weekly-balance', 'global', NULL, 'info', 'critical', '{}', 'open', '2026-06-02T00:00:00.000Z')`).run();
    raw.close();
  });

  after(() => { /* same cleanup shape as 4a */ });

  it("does not throw at require time", () => {
    process.env.DASHBOARD_DB_PATH = tempDbPath;
    delete require.cache[require.resolve("../db")];
    assert.doesNotThrow(() => require("../db"));
  });

  it("leaves the table WITHOUT the CHECK (rebuild skipped, not silently forced)", () => {
    const { db } = require("../db");
    const meta = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='coach_observations'").get();
    assert.ok(!meta.sql.includes("CHECK(severity IN"), "the CHECK must NOT be present — the rebuild must have skipped");
  });

  it("does not rewrite the offending row's severity value", () => {
    const { db } = require("../db");
    const row = db.prepare("SELECT * FROM coach_observations WHERE id = 2").get();
    assert.equal(row.severity, "critical", "the frozen historical value must survive untouched, even though it violates the new enum");
  });
});
```

**Test data / fixtures:** hand-built legacy DBs, same technique as
`agents-legacy-rebuild.test.js` — no shared fixture file needed (each `before`
builds its own throwaway DB via `better-sqlite3` directly, bypassing `db.js`
so the legacy shape is exact).

**How to run:** `node --test server/__tests__/db-migration.test.js`

**Red-first note:** 4a's items 2/3/4 are inherently red pre-build (there is
no rebuild block yet, so the `CHECK` is never added and the `critical` insert
in item 4 would succeed instead of throwing). 4b is red in the opposite,
subtler sense pre-build: because there's no rebuild logic at all yet, "does
not throw" trivially passes and "CHECK absent" trivially passes too — this
specific sub-test only becomes meaningful *after* 4a's rebuild exists, so
run 4b immediately after 4a is verified red→green, confirming 4b's skip
behavior is actually reachable (i.e., temporarily disable the pre-flight scan
in the real rebuild code and confirm 4b's "does not throw" test starts
failing — that's the mutation-proof for the skip path specifically, since a
naive rebuild-always implementation would make 4b throw on `critical`'s
`CHECK` violation during the `INSERT INTO … SELECT` copy step).

---

## 5. Component-level tests — `PlaybookPage.tsx`

**File:** `client/src/pages/__tests__/PlaybookPage.test.tsx` (confirmed this
file **already exists**, contra the technical plan's "new file" framing in
its change-set table — it is a pre-existing v1 test file, `enabled`/
`threshold`-only coverage, that needs extending, not creating from scratch).

**Fixture extension (do this first, don't clone a parallel fixture):** add
the four new fields to both existing fixtures, confirmed at lines 16-38:

```ts
const PRACTICE = {
  ...
  kindOverride: null,
  severityOverride: null,
  resolvedKind: "risk",       // === kind, since kindOverride is null
  resolvedSeverity: "warning",
};

const ACCOUNT_BALANCE_PRACTICE = {
  ...
  kindOverride: null,
  severityOverride: null,
  resolvedKind: "info",
  resolvedSeverity: "info",
};
```

`updatePracticeConfig.mockResolvedValue(...)` (line 63) should also echo
`kindOverride`/`severityOverride`/`resolvedKind`/`resolvedSeverity` in its
resolved value per-test, matching whatever the test's PUT payload implies —
don't let the mock silently keep returning stale pre-override fields.

### 5a. Selector defaults

**Test name:** `"renders the kind and severity selectors defaulted to 'use default' naming the catalog value"`
```tsx
it("renders the kind and severity selectors defaulted to 'use default' naming the catalog value", async () => {
  renderPage();
  await screen.findByText("Session Token Ceiling");
  // kindLabel.risk = "Warning" (confirmed client/src/i18n/locales/en/coach.json:17)
  expect(await screen.findByText(/Use default \(Warning\)/)).toBeInTheDocument();
  // severityLabel.warning = "Elevated" (per technical-plan.md §2.3/Step 8's table)
  expect(await screen.findByText(/Use default \(Elevated\)/)).toBeInTheDocument();
});
```
Confirm the exact interpolation key/copy (`playbook.useDefaultOption`) and
the `severityLabel.warning` string against whatever ships — the plan's Step 8
table is the proposed copy, not guaranteed verbatim; if the implementer
changes it, update this assertion to match rather than the other way around.

### 5b. Live preview updates before save (the regression this whole component-test layer exists to catch — R4 in the plan's risk table)

**Test name:** `"changing the kind selector updates the live preview immediately, before any save"`
```tsx
it("changing the kind selector updates the live preview immediately, before any save", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Session Token Ceiling");

  // Preview starts showing the catalog kind's badge label ("Warning" for risk).
  expect(screen.getAllByText("Warning").length).toBeGreaterThan(0);

  await user.selectOptions(screen.getByLabelText(/kind/i), "good");

  await waitFor(() => {
    expect(screen.getByText("Reinforcement")).toBeInTheDocument(); // kindLabel.good
  });
  // No save happened.
  expect(updatePracticeConfig).not.toHaveBeenCalled();
});
```
This is the one test in the whole plan that can see the lines-257/335
regression: if `kind={practice.kind}` is left bare instead of
`kind={resolveKind(practice, kindDraft)}`, the preview badge stays "Warning"
after selecting "Reinforcement" and this assertion fails — nothing
server-side or route-level can ever exercise this path.

### 5c. Save payload carries both overrides

**Test name:** `"saving sends kindOverride and severityOverride in the patch"`
```tsx
it("saving sends kindOverride and severityOverride in the patch", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Session Token Ceiling");
  await user.selectOptions(screen.getByLabelText(/kind/i), "good");
  await user.selectOptions(screen.getByLabelText(/severity/i), "info");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => {
    expect(updatePracticeConfig).toHaveBeenCalledWith(
      "session-token-ceiling",
      expect.objectContaining({ kindOverride: "good", severityOverride: "info" })
    );
  });
});
```

### 5d. Clearing sends `null`

**Test name:** `"selecting 'use default' after an override sends null on save"`
```tsx
it("selecting 'use default' after an override sends null on save", async () => {
  listPractices.mockResolvedValue({
    practices: [{ ...PRACTICE, kindOverride: "good", resolvedKind: "good" }],
  });
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Session Token Ceiling");
  await user.selectOptions(screen.getByLabelText(/kind/i), ""); // the "use default" option
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => {
    expect(updatePracticeConfig).toHaveBeenCalledWith(
      "session-token-ceiling",
      expect.objectContaining({ kindOverride: null })
    );
  });
});
```

### 5e. Run 5a–5d for the second card fixture too (DEC-2 — generic, every card)

Duplicate (or table-drive with `it.each`) 5a/5b/5c/5d against
`ACCOUNT_BALANCE_PRACTICE` — DEC-2 requires the control on every card, and a
selector that only works on the first card it was wired into is exactly the
per-practice-special-case shape the plan forbids.

### 5f. Explicit non-assertion (carry QA §3d's note into the file as a comment, per the plan)

Add a comment near the top of the extended test file:
```ts
// This page only ever shows the live RESOLVED value (draft or saved) — it
// never renders a persisted coach_observations row's frozen kind/severity.
// Per §9.1's explicit non-application here (technical-plan.md §2.4/§5): do
// NOT add a "UI must match a Feed row" cross-check test in this file. The
// two are supposed to diverge after an override change; asserting they
// match would demand the wrong behavior.
```
No test case needed for this — it is a guard against a *future* wrong test
being added, not a behavior to assert now.

**Test data / fixtures:** extends the file's own existing `PRACTICE` /
`ACCOUNT_BALANCE_PRACTICE` fixtures and `vi.mock("../../lib/api", ...)` mock
(confirmed lines 16-50) — no new fixture file.

**How to run:** `cd client && npx vitest run src/pages/__tests__/PlaybookPage.test.tsx`

**Red-first note:** 5b is the load-bearing one — it must be shown failing
against the pre-fix `PlaybookPage.tsx` (bare `kind={practice.kind}` at lines
257/335). Confirm this by running 5b once before the two lines are patched:
selecting "good" must show the preview still reading the catalog label
("Warning" for `session-token-ceiling`), which is a passing assertion for
the *bug*, i.e. a failing assertion against the *test's* expectation
("Reinforcement") — that failure is what proves the test is non-vacuous.
5a/5c/5d are naturally red pre-build (the selectors/fields don't exist at
all yet, so `getByLabelText(/kind/i)` throws a "not found" error).

---

## 6. Unit test for the client draft-resolution helper (small, but load-bearing for 5b)

**Naming ambiguity to resolve before writing this — flag to the implementer:**
the change-brief's "Changed files" table names the new `playbookStore.ts`
export `resolveKind`/`resolveSeverity`; the technical plan's own Step 9.3
names it `resolveDraftKind`/`resolveDraftSeverity`. Confirm the actual
exported name against the shipped `playbookStore.ts` before writing this
test — do not guess and silently import a name that doesn't exist (that
would either fail to compile, which is at least loud, or — if a stray
same-named export exists elsewhere — silently test the wrong function).

**File:** `client/src/lib/__tests__/playbookStore.test.ts` — **new file**
(none exists today; model the `describe`/mock-free pure-function-test shape
on `client/src/lib/__tests__/focusStore.test.ts` and
`client/src/lib/__tests__/windowedTotals.test.ts`, the latter being the
plan's own cited precedent for the "documented client-side duplication"
comment shape this helper carries).

**Test name:** `"resolveKind: draft value wins when defined, else the stored override, else the catalog kind"`
```ts
it("resolveKind: draft value wins when defined, else the stored override, else the catalog kind", () => {
  const practice = { kind: "risk", kindOverride: "good" } as PlaybookPractice;
  assert.equal(resolveKind(practice, "info"), "info");   // draft wins
  assert.equal(resolveKind(practice, null), null ?? practice.kind); // explicit draft-clear -> falls to kindOverride ?? kind per the formula; confirm exact precedence against the shipped implementation
  assert.equal(resolveKind(practice, undefined), "good"); // no draft yet -> stored override
  assert.equal(resolveKind({ ...practice, kindOverride: null }, undefined), "risk"); // no override either -> catalog
});
```
Note: the exact `null` vs `undefined` precedence in the middle case must be
pinned against the *shipped* formula in Step 9.3
(`(draft !== undefined ? draft : p.kindOverride) ?? p.kind`) rather than
assumed — write this assertion by reading the actual function, not this
document, since it's easy to get `null`-as-"explicit clear" vs
`undefined`-as-"not yet touched" backwards.

**Why this earns its own unit test despite being "just" a client helper
feeding a component test:** 5b already proves the wiring end-to-end, but a
pure-function test here pins the *precedence rule itself* independent of any
DOM rendering — cheaper to run, and it is the one place that can assert the
`null`-vs-`undefined` distinction precisely (a DOM-level test can only ever
observe the rendered label, not which branch of the ternary produced it).

**Red-first note:** naturally red pre-build (the function doesn't exist yet).

---

## Summary of files touched by this test design

| File | Action |
|---|---|
| `server/__tests__/playbook.test.js` | Extend — §1 (2 frozen-snapshot tests + 1 status-isolation test), §3 (6 route tests) |
| `server/__tests__/playbook-resolver-guard.test.js` | **New** — §2 (3 structural-guard assertions) |
| `server/__tests__/db-migration.test.js` | Extend — §4 (2 new `describe` blocks, 9 test cases total, no `UPGRADE_CASES`/`GRANDFATHERED` entry) |
| `client/src/pages/__tests__/PlaybookPage.test.tsx` | Extend (pre-existing file, not new) — §5 (5 test cases × 2 card fixtures) |
| `client/src/lib/__tests__/playbookStore.test.ts` | **New** — §6 (pure-function precedence test) |

## How to run (from `package.json`, confirmed)

```
npm test                                                          # full suite, baseline before AND after
npm run test:server
node --test server/__tests__/playbook.test.js
node --test server/__tests__/db-migration.test.js
node --test server/__tests__/playbook-resolver-guard.test.js
npm run test:client
cd client && npx vitest run src/pages/__tests__/PlaybookPage.test.tsx
cd client && npx vitest run src/lib/__tests__/playbookStore.test.ts
grep -n "practice\.kind\|practice\.defaultSeverity" server/lib/playbook/engine.js   # must return nothing, post-build
```

## Cross-cutting red-first requirement (§9.3), summarized

Every test above is either (a) naturally red pre-build because the behavior
it names doesn't exist yet (most of §3, §4a items 2-4, §5, §6), or (b) a
structural guard / regression test that must be **actively proven red by
mutation** before it counts (§1's two frozen-snapshot tests — pre-build
engine writes catalog values, not resolved ones; §2's three guard
assertions — proven red by injecting rogue readers into `engine.js` and
`PlaybookPage.tsx`, per the exact procedure in §2's "Red-first proof"
subsection; §4b's skip-path test — proven meaningful by temporarily
disabling the pre-flight scan and confirming it starts failing). Record each
(b)-category red observation in the PR/commit message — a green suite with
no recorded red state is, per this project's own §9.3 VACUOUS-GUARD entry,
not proof of anything.
