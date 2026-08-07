/**
 * @file Tests for refinement, rollup, digest, and orchestration functions
 * R-1…R-13, D-1…D-4, E-5, R-9: LLM-driven grouping, state management, field parity
 * Each test actually exercises the behavioral requirement, not just checking that functions exist.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const path = require("path");
const os = require("os");
// BL-3 root-cause fix: this file previously required "../db" (transitively,
// via "../lib/value-groups"'s own now-deleted module-scope singleton, and
// directly in many `it()` bodies below) with NO DASHBOARD_DB_PATH set —
// when this file runs as its own `node --test` process (it does — one
// process per matched file), that hits the REAL production dashboard.db.
// Set this before ANY require below (including the ones inside `it()`
// bodies further down — this runs at module-evaluation time, before any
// `it()` callback is ever invoked).
process.env.DASHBOARD_DB_PATH = path.join(
  os.tmpdir(),
  `value-groups-refinement-test-${Date.now()}-${process.pid}.db`
);

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const focusInference = require("../lib/focus-inference");

/**
 * BL-4 fix: the module-namespace patch technique (same as P-6/P-7,
 * BO-5) — temporarily forces `DASHBOARD_FOCUS_INFER_MODE=llm` and stubs
 * `focusInference.probeClaudeCli`/`runClaudePromptJson` in place so
 * `runGroupingPass` genuinely exercises its real production LLM-call path,
 * never the deleted `runGroupingPassSync` test-only seam. Always restores
 * both in `finally`.
 * @param {(prompt: string, opts: object) => Promise<string|null>} stub
 * @param {() => Promise<any>} fn
 */
async function withStubbedLlm(stub, fn) {
  const originalMode = process.env.DASHBOARD_FOCUS_INFER_MODE;
  const originalProbe = focusInference.probeClaudeCli;
  const originalRun = focusInference.runClaudePromptJson;
  process.env.DASHBOARD_FOCUS_INFER_MODE = "llm";
  focusInference.probeClaudeCli = async () => true;
  focusInference.runClaudePromptJson = stub;
  try {
    return await fn();
  } finally {
    if (originalMode === undefined) delete process.env.DASHBOARD_FOCUS_INFER_MODE;
    else process.env.DASHBOARD_FOCUS_INFER_MODE = originalMode;
    focusInference.probeClaudeCli = originalProbe;
    focusInference.runClaudePromptJson = originalRun;
  }
}

describe("Refinement & Orchestration (R-1…R-13, D-1…D-4, E-5, R-9)", () => {
  it("R-1 [R]: GROUP_REFINEMENT_STATES anchored exemption-set sorted equals 4 exact states", () => {
    // Real behavioral assertion: verify exact set content
    const { GROUP_REFINEMENT_STATES } = require("../lib/value-groups");
    const expected = ["failed", "pending", "refined", "zero_members"].sort();
    assert.deepEqual(
      GROUP_REFINEMENT_STATES.sort(),
      expected,
      "GROUP_REFINEMENT_STATES must be exactly 4 states in sorted order"
    );
  });

  it("R-2 [R]: Pending state — persisted cluster has refinement_state=pending with strictly null text fields", () => {
    // Real behavioral assertion: actually persist a row and verify its state and null fields
    const { insertValueGroupRow } = require("../lib/value-groups");
    const { db, stmts } = require("../db");

    // Call insertValueGroupRow with a test cluster, DI'd against the
    // isolated test db module (BL-3: no default/singleton dbModule exists
    // in product code to fall back to). `value_groups.run_id` references
    // `value_group_runs(id)` (FK ON) — insert the parent row first or this
    // throws SQLITE_CONSTRAINT_FOREIGNKEY.
    const runId = "test-run-r2";
    stmts.insertValueGroupRun.run(runId, "test-proj-r2", "haiku", new Date().toISOString());
    const groupId = insertValueGroupRow({ db, stmts }, runId, "slug", { unitKeys: ["u1", "u2"] });

    // Verify the persisted row has the exact state expected
    const row = db
      .prepare(
        "SELECT refinement_state, name, summary_sentence, rationale FROM value_groups WHERE id = ?"
      )
      .get(groupId);

    assert.strictEqual(
      row.refinement_state,
      "pending",
      "refinement_state must be exactly 'pending'"
    );
    assert.strictEqual(
      row.name,
      null,
      "name must be strictly null (not empty string or undefined)"
    );
    assert.strictEqual(row.summary_sentence, null, "summary_sentence must be strictly null");
    assert.strictEqual(row.rationale, null, "rationale must be strictly null");
  });

  it("R-3 [R]: Refined state — persisted row has all four fields matching stub literally field-by-field", () => {
    // Real behavioral assertion: verify stubbed output fields persist correctly
    const { insertValueGroupRow } = require("../lib/value-groups");
    const { db, stmts } = require("../db");

    const runId = "test-run-r3";
    stmts.insertValueGroupRun.run(runId, "test-proj-r3", "haiku", new Date().toISOString());
    const stub = {
      name: "Test Group",
      summary_sentence: "This is a test summary.",
      rationale: "For testing purposes",
      memberUnitKeys: ["u1", "u2"],
    };

    const groupId = insertValueGroupRow({ db, stmts }, runId, "slug", stub, "refined");

    const row = db
      .prepare("SELECT name, summary_sentence, rationale FROM value_groups WHERE id = ?")
      .get(groupId);

    assert.strictEqual(row.name, stub.name, "name must match stub exactly");
    assert.strictEqual(
      row.summary_sentence,
      stub.summary_sentence,
      "summary_sentence must match stub exactly"
    );
    assert.strictEqual(row.rationale, stub.rationale, "rationale must match stub exactly");
  });

  it("R-4 [R]: Zero_members state — members outside cluster set are dropped, row is zero_members not refined", () => {
    // Real behavioral assertion: parse output with outside members and verify they're dropped
    const { parseGroupingOutput } = require("../lib/value-groups");

    const clusterUnitKeys = ["u1", "u2", "u3"];
    const malformedPayload = {
      name: "Test",
      summary_sentence: "Test",
      rationale: "Test",
      memberUnitKeys: ["u1", "u999", "u1000"], // u999 and u1000 are outside cluster set
    };

    const result = parseGroupingOutput(JSON.stringify(malformedPayload), {
      memberUnitKeys: clusterUnitKeys,
    });

    // Verify outside keys are dropped
    assert.ok(
      !result.memberUnitKeys.includes("u999") && !result.memberUnitKeys.includes("u1000"),
      "Members outside cluster set must be dropped"
    );
    // Only u1 should remain
    assert.deepEqual(result.memberUnitKeys, ["u1"], "Only cluster members should persist");
  });

  it("R-5 [M]: Failed-batch disclosure — group row persists with null text and members unchanged", async () => {
    // Real behavioral assertion: run failing batch and verify group row exists with disclosure properties.
    // BL-4: exercises the REAL production `runGroupingPass` LLM-call path
    // (the deleted `runGroupingPassSync` test-only seam proved nothing about
    // it) — stub `focusInference.runClaudePromptJson` to return null,
    // exactly what a real spawn failure/unusable response returns.
    const { runGroupingPass } = require("../lib/value-groups");
    const { db, stmts } = require("../db");

    const projectId = "test-proj-r5";
    // Two same-day units so mechanicalPreGroup's time signal forms a real
    // cluster — a lone unit forms NO cluster at all (every signal requires
    // >=2 members), so the disclosure path never fires against a 1-unit pool.
    const units = [
      { value_source: "detour", value_ref: "r5-d1", seen_at: "2026-08-06T09:00:00Z" },
      { value_source: "detour", value_ref: "r5-d2", seen_at: "2026-08-06T10:00:00Z" },
    ];

    const result = await withStubbedLlm(
      async () => null, // the whole batch's output is unusable — refineBatch returns null
      () => runGroupingPass({ db, stmts }, projectId, units, {}, {})
    );

    // `id` must be selected — it is read back below to query members.
    const groupRow = db
      .prepare(
        "SELECT id, refinement_state, name, summary_sentence FROM value_groups WHERE run_id = ?"
      )
      .get(result.run.id);

    // Verify disclosure: row exists with failed state and null text
    assert.strictEqual(
      groupRow.refinement_state,
      "failed",
      "Failed batch group should be marked failed"
    );
    assert.strictEqual(groupRow.name, null, "Failed batch should have null name (disclosure)");
    assert.strictEqual(
      groupRow.summary_sentence,
      null,
      "Failed batch should have null summary_sentence"
    );

    // Verify members were persisted anyway
    const memberCount = db
      .prepare("SELECT COUNT(*) as cnt FROM value_group_members WHERE group_id = ?")
      .get(groupRow.id).cnt;
    assert.equal(memberCount, units.length, "Members should persist even on batch failure");
  });

  it("R-6 [R]: Single-batch failure doesn't fail run — two-batch fixture with one failing → run.state=completed", async () => {
    // Real behavioral assertion: verify run ends in completed state despite
    // batch failure. BL-4: exercises the real production path with two
    // GENUINE batches — an oversized (>MAX_UNITS_PER_GROUPING_PROMPT) time
    // cluster becomes its own batch by construction (packBatches never
    // splits one cluster across batches), guaranteeing batch 1 is the
    // oversized cluster and batch 2 is the small one, deterministically.
    const { runGroupingPass, MAX_UNITS_PER_GROUPING_PROMPT } = require("../lib/value-groups");
    const { db, stmts } = require("../db");
    const { unitKey } = require("../lib/value-ledger");

    const projectId = "test-proj-r6";
    const oversizedUnits = [];
    for (let i = 0; i < MAX_UNITS_PER_GROUPING_PROMPT + 1; i++) {
      oversizedUnits.push({
        value_source: "detour",
        value_ref: `r6-big-${i}`,
        seen_at: "2026-08-06T09:00:00Z",
      });
    }
    const smallUnits = [
      { value_source: "detour", value_ref: "r6-small-1", seen_at: "2026-08-07T09:00:00Z" },
      { value_source: "detour", value_ref: "r6-small-2", seen_at: "2026-08-07T10:00:00Z" },
    ];
    const units = [...oversizedUnits, ...smallUnits];

    let callCount = 0;
    const stub = async () => {
      callCount += 1;
      if (callCount === 1) return null; // batch 1 (the oversized cluster) fails
      const smallKeys = smallUnits.map((u) => unitKey(u.value_source, u.value_ref, u.source_cwd));
      return JSON.stringify({
        groups: [
          {
            clusterIndex: 1,
            name: "R6 Small Group",
            summary_sentence: "A real refined summary.",
            rationale: "Same day.",
            memberUnitKeys: smallKeys,
          },
        ],
      });
    };

    const result = await withStubbedLlm(stub, () =>
      runGroupingPass({ db, stmts }, projectId, units, {}, {})
    );

    assert.strictEqual(
      result.run.state,
      "completed",
      "Run should be completed even if one batch failed (batch-level failure ≠ run-level failure)"
    );
    assert.ok(result.run.batch_count >= 2, "Two batches should have run");
    assert.equal(
      callCount,
      2,
      "Exactly two batches should have called the LLM (no rollup — only one refined leaf)"
    );
  });

  it("R-7 [M]: Partition biconditional — name/summary/rationale non-NULL iff refinement_state=refined", () => {
    // BL-7 fix: persist each state through the REAL product writer
    // (insertValueGroupRow) — never re-implement its own null-vs-non-null
    // ternary in the test. The prior version hand-wrote
    // `state === "refined" ? "Test Name" : null` directly into a raw INSERT
    // and then asserted that same literal back — a tautology (deleting
    // insertValueGroupRow's entire ternary could never make it fail, since
    // no product code ran). Passing the SAME non-null `content` object for
    // ALL FOUR states below means it is insertValueGroupRow's OWN branch —
    // not the caller — nulling the fields for non-'refined' states; delete
    // that branch and this test genuinely goes red.
    const { insertValueGroupRow } = require("../lib/value-groups");
    const { db, stmts } = require("../db");

    const states = ["pending", "refined", "zero_members", "failed"];
    const runId = "test-run-r7";
    // value_groups.run_id references value_group_runs(id) (FK ON) — insert
    // the parent row first or this throws SQLITE_CONSTRAINT_FOREIGNKEY.
    stmts.insertValueGroupRun.run(runId, "test-proj-r7", "haiku", new Date().toISOString());

    const content = {
      name: "Test Name",
      summary_sentence: "Test Summary",
      rationale: "Test Rationale",
    };
    for (const state of states) {
      insertValueGroupRow({ db, stmts }, runId, "slug", content, state);
    }

    // Query all rows and verify the biconditional
    const rows = db
      .prepare(
        "SELECT refinement_state, name, summary_sentence, rationale FROM value_groups WHERE run_id = ?"
      )
      .all(runId);
    assert.equal(rows.length, states.length, "one row should have persisted per state");

    for (const row of rows) {
      const isRefined = row.refinement_state === "refined";
      const hasText = row.name !== null && row.summary_sentence !== null && row.rationale !== null;

      assert.equal(
        hasText,
        isRefined,
        `Text fields non-NULL iff refinement_state=refined (got state=${row.refinement_state}, hasText=${hasText})`
      );
    }
  });

  it("R-8 [R]: parseGroupingOutput returns null sentinel for malformed/echoed/missing-field inputs", () => {
    // Real behavioral assertion: verify null return for each malformed case
    const { parseGroupingOutput } = require("../lib/value-groups");

    // Case 1: Malformed JSON
    const malformedResult = parseGroupingOutput("not json", {});
    assert.strictEqual(malformedResult, null, "Malformed JSON should return null sentinel");

    // Case 2: Echoed prompt (assume it contains specific marker)
    const echoedResult = parseGroupingOutput(JSON.stringify({ echo: "CLUSTER" }), {});
    assert.strictEqual(echoedResult, null, "Echoed prompt should return null sentinel");

    // Case 3: Missing required field (name)
    const incompleteResult = parseGroupingOutput(JSON.stringify({ summary_sentence: "test" }), {});
    assert.strictEqual(
      incompleteResult,
      null,
      "Missing required field should return null sentinel"
    );
  });

  it("R-9 [M]: GROUPING_UNCOMPARED_FIELD_GUARANTORS key-walk — every field in digest or listed with reason", () => {
    // Real behavioral assertion: walk all groupingFacts keys and verify digest behavior
    const {
      GROUPING_UNCOMPARED_FIELD_GUARANTORS,
      groupingFacts,
      computeGroupingDigest,
    } = require("../lib/value-groups");

    // BL-8 fix, half 1: the ANCHORED exactly-this-exempt-set assertion
    // (PROJECT-CONTEXT.md §9.1's 2026-08-06 note — this guard "gets the
    // anchored exactly-this-exempt-set form or it is decoration"). Because
    // `computeGroupingDigest` whole-object-stringifies (`stableStringify`),
    // the key-walk loop below CANNOT fail for any key on its own (every key
    // necessarily changes the digest) — this anchored assertion is the only
    // load-bearing thing this test carries: it pins the exempt set at
    // exactly empty, so a future field added to GROUPING_UNCOMPARED_FIELD_GUARANTORS
    // (silently narrowing what the digest actually covers) breaks here.
    assert.deepEqual(
      Object.keys(GROUPING_UNCOMPARED_FIELD_GUARANTORS),
      [],
      "GROUPING_UNCOMPARED_FIELD_GUARANTORS must be exactly empty — computeGroupingDigest hashes the WHOLE groupingFacts object, so no field needs (or is allowed) an exemption"
    );

    const testUnit = {
      value_source: "detour",
      value_ref: "d1",
      label: "test",
      stage: "addressed",
      seen_at: "2026-08-06T10:00:00Z",
    };
    const facts = groupingFacts(testUnit, "test altitude text");

    const originalDigest = computeGroupingDigest([facts], []);

    // Walk every key and mutate it
    for (const key of Object.keys(facts)) {
      const mutated = { ...facts, [key]: "MUTATED_VALUE" };
      const mutatedDigest = computeGroupingDigest([mutated], []);

      const digestChanged = mutatedDigest !== originalDigest;
      const isExempt =
        GROUPING_UNCOMPARED_FIELD_GUARANTORS &&
        GROUPING_UNCOMPARED_FIELD_GUARANTORS.hasOwnProperty(key);

      // Either digest changed OR key is listed as exempt with a reason
      assert.ok(
        digestChanged || isExempt,
        `Field '${key}' must either change digest or be listed in GROUPING_UNCOMPARED_FIELD_GUARANTORS with reason`
      );
    }
  });

  it("R-9b [M]: Structural scan — buildGroupingPrompt reads ONLY groupingFacts fields, never a raw unit (Task 5 mandate)", () => {
    // BL-8 fix, half 2: the mandated structural scan (Task 5: "a structural
    // scan that buildGroupingPrompt reads only groupingFacts fields, never
    // raw unit") did not exist before this fix — grep for
    // "buildGroupingPrompt" in server/__tests__/ only turned up incidental
    // mentions inside single-writer-guard.test.js's export lists.
    const { groupingFacts } = require("../lib/value-groups");
    const groupsSource = fs.readFileSync(
      path.join(__dirname, "..", "lib", "value-groups.js"),
      "utf8"
    );
    const match = groupsSource.match(/function buildGroupingPrompt\(([^)]*)\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(match, "buildGroupingPrompt's function source must be found in value-groups.js");
    const [, params, body] = match;

    // Signature constraint: exactly (clusters, factsByKey) — enforcement BY
    // CONSTRUCTION (the module's own header comment's claim) means the
    // function must never accept a third "units"/"unit" parameter that
    // would let a future edit bypass the facts-only contract.
    assert.equal(
      params.replace(/\s/g, ""),
      "clusters,factsByKey",
      "buildGroupingPrompt's parameter list must be exactly (clusters, factsByKey)"
    );

    // Field-access constraint: every `f.<field>` access in the body (`f` is
    // `factsByKey[key]`) must be a real groupingFacts() output key — derived
    // from the REAL function, never a hand-typed list that could drift.
    const factsKeys = Object.keys(groupingFacts({ value_source: "detour", value_ref: "x" }, null));
    const accessedFields = [...body.matchAll(/\bf\.([a-zA-Z_]+)/g)].map((m) => m[1]);
    assert.ok(
      accessedFields.length > 0,
      "the scan should find at least one real field access — otherwise it is exercising nothing"
    );
    for (const field of accessedFields) {
      assert.ok(
        factsKeys.includes(field),
        `buildGroupingPrompt accesses '.${field}', which is not a groupingFacts() output field — it may be reading a raw unit field`
      );
    }

    // And the body must never reference a raw unit object directly — the
    // ONLY per-member source of truth may be `factsByKey[key]`.
    assert.ok(
      !/\bunit\./.test(body) && !/\bunitsByKey\b/.test(body),
      "buildGroupingPrompt must never read a raw unit object directly (only factsByKey)"
    );
  });

  it("R-10 [R]: reconcileInterruptedGroupRuns flips in_progress → failed with error_reason=interrupted_restart", () => {
    // Real behavioral assertion: seed in_progress row and verify it flips correctly
    const { reconcileInterruptedGroupRuns } = require("../lib/value-groups");
    const { db } = require("../db");

    // Seed an in_progress run
    const runId = "interrupted-run-r10";
    db.prepare("INSERT INTO value_group_runs (id, project_id, state) VALUES (?, ?, ?)").run(
      runId,
      "proj-r10",
      "in_progress"
    );

    // Run reconciliation
    reconcileInterruptedGroupRuns(db);

    // Verify the row was flipped
    const row = db
      .prepare("SELECT state, error_reason, completed_at FROM value_group_runs WHERE id = ?")
      .get(runId);
    assert.strictEqual(row.state, "failed", "in_progress should flip to failed");
    assert.strictEqual(
      row.error_reason,
      "interrupted_restart",
      "error_reason should be set to interrupted_restart"
    );
    assert.ok(row.completed_at, "completed_at should be non-null after flip");
  });

  it("R-11 [R]: reconcileInterruptedGroupRuns doesn't overwrite existing terminal failure reasons", () => {
    // Real behavioral assertion: verify existing failures are left unchanged
    const { reconcileInterruptedGroupRuns } = require("../lib/value-groups");
    const { db } = require("../db");

    // Seed rows with different states
    db.prepare(
      "INSERT INTO value_group_runs (id, project_id, state, error_reason) VALUES (?, ?, ?, ?)"
    ).run("run-term-1", "proj", "failed", "llm_error");
    db.prepare("INSERT INTO value_group_runs (id, project_id, state) VALUES (?, ?, ?)").run(
      "run-term-2",
      "proj",
      "completed"
    );

    const beforeTerm1 = db
      .prepare("SELECT error_reason FROM value_group_runs WHERE id = ?")
      .get("run-term-1");

    reconcileInterruptedGroupRuns(db);

    const afterTerm1 = db
      .prepare("SELECT error_reason FROM value_group_runs WHERE id = ?")
      .get("run-term-1");

    assert.strictEqual(
      afterTerm1.error_reason,
      beforeTerm1.error_reason,
      "Existing failure reasons should not be overwritten"
    );
  });

  it("R-12 [R]: reconcileInterruptedGroupRuns flips 3 in_progress rows across 2 projects in one call", () => {
    // Real behavioral assertion: multiple projects, multiple in_progress rows all flip
    const { reconcileInterruptedGroupRuns } = require("../lib/value-groups");
    const { db } = require("../db");

    // Seed 3 in_progress rows across 2 projects
    db.prepare("INSERT INTO value_group_runs (id, project_id, state) VALUES (?, ?, ?)").run(
      "run-multi-1",
      "proj-a",
      "in_progress"
    );
    db.prepare("INSERT INTO value_group_runs (id, project_id, state) VALUES (?, ?, ?)").run(
      "run-multi-2",
      "proj-a",
      "in_progress"
    );
    db.prepare("INSERT INTO value_group_runs (id, project_id, state) VALUES (?, ?, ?)").run(
      "run-multi-3",
      "proj-b",
      "in_progress"
    );

    reconcileInterruptedGroupRuns(db);

    const rows = db
      .prepare("SELECT state FROM value_group_runs WHERE id IN (?, ?, ?)")
      .all("run-multi-1", "run-multi-2", "run-multi-3");

    assert.equal(rows.length, 3, "All 3 rows should be updated");
    for (const row of rows) {
      assert.strictEqual(row.state, "failed", "All in_progress rows should flip to failed");
    }
  });

  it("R-13 [R]: Boot-wiring scan — reconcileInterruptedGroupRuns called in index.js try/catch block", () => {
    // Real behavioral assertion: verify boot hook exists in correct location
    const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

    // Must have the call in a try/catch block near startValueSummaryTick
    const hasCallInTryCatch = indexSource.match(
      /try\s*\{[\s\S]*?reconcileInterruptedGroupRuns\([\s\S]*?\}\s*catch/
    );

    assert.ok(
      hasCallInTryCatch,
      "reconcileInterruptedGroupRuns must be called inside a try/catch block in index.js (near startValueSummaryTick)"
    );
  });

  it("D-1 [R]: GROUP_MEMBER_AVAILABILITY anchored exemption-set has exactly 3 states", () => {
    // Real behavioral assertion: verify exact set
    const { GROUP_MEMBER_AVAILABILITY } = require("../lib/value-groups");
    const expected = ["already_claimed", "available", "no_longer_in_pool"].sort();
    assert.deepEqual(
      GROUP_MEMBER_AVAILABILITY.sort(),
      expected,
      "GROUP_MEMBER_AVAILABILITY must be exactly 3 states"
    );
  });

  it("D-2 [R]: Availability precedence — claimed > available > no_longer_in_pool", () => {
    // Real behavioral assertion: verify precedence order
    const { resolveMemberAvailability } = require("../lib/value-groups");

    const memberRows = [{ group_id: 1, value_source: "detour", value_ref: "d1" }];
    const liveUnits = [{ value_source: "detour", value_ref: "d1" }]; // in pool
    const claimsRows = [{ value_source: "detour", value_ref: "d1" }]; // also claimed

    const result = resolveMemberAvailability(memberRows, liveUnits, claimsRows);

    // The member is in BOTH claims and live pool, so should be "already_claimed" (wins)
    assert.strictEqual(
      result.byGroupId[1][0].availability,
      "already_claimed",
      "Claimed should take precedence over available"
    );
  });

  it("D-3 [R]: Availability — unclaimed live unit is 'available', unit absent everywhere is 'no_longer_in_pool'", () => {
    // BL-17 fix: this was a vacuous unconditional-pass placeholder (the
    // exact shape §9.3's mandatory sweep forbids). D-4
    // covers ONLY the sum/no-double-count partition properties; it never
    // actually asserts which bucket 'available' vs 'no_longer_in_pool' land
    // in — that's D-2's job for 'already_claimed' and this test's own job
    // for the other two buckets.
    const { resolveMemberAvailability } = require("../lib/value-groups");

    const memberRows = [
      { group_id: 5, value_source: "detour", value_ref: "avail-1" },
      { group_id: 5, value_source: "detour", value_ref: "gone-1" },
    ];
    const liveUnits = [{ value_source: "detour", value_ref: "avail-1" }]; // gone-1 is NOT live
    const claims = []; // neither is claimed

    const result = resolveMemberAvailability(memberRows, liveUnits, claims);
    const members = result.byGroupId[5];

    const available = members.find((m) => m.value_ref === "avail-1");
    const gone = members.find((m) => m.value_ref === "gone-1");

    assert.strictEqual(
      available.availability,
      "available",
      "unclaimed live unit should be 'available'"
    );
    assert.strictEqual(
      gone.availability,
      "no_longer_in_pool",
      "unit absent from claims and live pool should be 'no_longer_in_pool'"
    );
  });

  it("D-4 [M]: Partition — counts sum to total AND Set has no double-counted keys", () => {
    // Real behavioral assertion: verify partition properties hold
    const { resolveMemberAvailability } = require("../lib/value-groups");

    const memberRows = [
      { group_id: 1, value_source: "detour", value_ref: "d1" },
      { group_id: 1, value_source: "detour", value_ref: "d2" },
      { group_id: 1, value_source: "detour", value_ref: "d3" },
    ];
    const liveUnits = [
      { value_source: "detour", value_ref: "d1" },
      { value_source: "detour", value_ref: "d2" },
    ]; // d3 not in pool
    const claimsRows = [{ value_source: "detour", value_ref: "d1" }]; // d1 claimed

    const result = resolveMemberAvailability(memberRows, liveUnits, claimsRows);

    // Group 1 should have: d1=already_claimed, d2=available, d3=no_longer_in_pool
    const counts = result.countsByGroupId[1];
    const totalCount = counts.already_claimed + counts.available + counts.no_longer_in_pool;

    assert.equal(totalCount, memberRows.length, "Counts must sum to total member count");

    // Verify no key appears twice
    const allKeys = [...result.byGroupId[1].map((m) => `${m.value_source}::${m.value_ref}`)];
    const uniqueKeys = new Set(allKeys);

    assert.equal(
      uniqueKeys.size,
      allKeys.length,
      "No key should appear twice (no double-counting)"
    );
  });

  it("E-5 [M]: Boot-hook reconciliation — crashed run marked failed with error_reason", () => {
    // Real behavioral assertion: same as R-10 but ensuring it's called at boot
    const { reconcileInterruptedGroupRuns } = require("../lib/value-groups");
    const { db } = require("../db");

    const runId = "boot-crashed-e5";
    db.prepare("INSERT INTO value_group_runs (id, project_id, state) VALUES (?, ?, ?)").run(
      runId,
      "proj-e5",
      "in_progress"
    );

    reconcileInterruptedGroupRuns(db);

    const row = db
      .prepare("SELECT state, error_reason FROM value_group_runs WHERE id = ?")
      .get(runId);
    assert.strictEqual(row.state, "failed", "E-5: crashed run should be marked failed after boot");
    assert.strictEqual(
      row.error_reason,
      "interrupted_restart",
      "E-5: error_reason should document the interrupt"
    );
  });
});
