/**
 * @file T8 server half: resolver parity test.
 * Drives a shared case table through both the server-side resolvePracticeConfig()
 * and the client-side resolveDraftKind/resolveDraftSeverity, asserting
 * identical results. This is the only guard that catches a second-order duplicate
 * resolver that disagrees with the canonical one (§9.1 second-order form, the
 * 2026-08-01 lesson reproduced by design).
 *
 * NOTE: This file tests only the serverApplicable=true cases against the server
 * resolver. Client-only draft cases are tested in playbookStore.test.ts. Do not
 * try to run client-side draft resolution through the server resolver — it has
 * no draft concept.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

describe("Resolver parity: server-side resolvePracticeConfig (T8 server half)", () => {
  let tempDir;
  let dbModule;
  let resolvePracticeConfig;
  let PRACTICES;
  let caseTable;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-parity-test-"));
    process.env.DASHBOARD_DB_PATH = path.join(tempDir, "test.db");

    // Clean require cache and load fresh
    delete require.cache[require.resolve("../db")];
    delete require.cache[require.resolve("../lib/playbook/practices")];

    dbModule = require("../db");
    const practicesModule = require("../lib/playbook/practices");
    resolvePracticeConfig = practicesModule.resolvePracticeConfig;
    PRACTICES = practicesModule.PRACTICES;

    // Load the shared case table
    const caseTablePath = path.join(__dirname, "fixtures", "playbook-resolution-cases.json");
    caseTable = JSON.parse(fs.readFileSync(caseTablePath, "utf8"));
  });

  after(() => {
    try {
      if (dbModule.db) dbModule.db.close();
    } catch {}
    try {
      delete require.cache[require.resolve("../db")];
      delete require.cache[require.resolve("../lib/playbook/practices")];
    } catch {}
    delete process.env.DASHBOARD_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(path.join(tempDir, "test.db" + suffix));
      } catch {}
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("drives every server-applicable case through resolvePracticeConfig, asserting correct resolved values", () => {
    const serverCases = caseTable.filter((c) => c.serverApplicable);
    assert(serverCases.length > 0, "no server-applicable cases in the fixture table");

    for (const testCase of serverCases) {
      const isKindTest = "catalogKind" in testCase;
      // Each fixture row's `catalogKind`/`catalogSeverity` is only meaningful
      // if it actually matches the real catalog value of the practice this
      // test drives it through — session-token-ceiling for kind cases,
      // account-weekly-balance for severity cases. Asserted explicitly below
      // (not just assumed) so a future catalog edit that silently
      // desynchronizes the fixture from the real practice fails loudly here,
      // instead of the test quietly exercising the wrong baseline value.
      const practiceId = isKindTest ? "session-token-ceiling" : "account-weekly-balance";
      const practice = PRACTICES.find((p) => p.id === practiceId);
      assert(practice, `Practice ${practiceId} not found in PRACTICES`);
      if (isKindTest) {
        assert.equal(
          practice.kind,
          testCase.catalogKind,
          `fixture catalogKind ('${testCase.catalogKind}') must match ${practiceId}'s real catalog kind ('${practice.kind}'). Test case: ${testCase.name}`
        );
      } else {
        assert.equal(
          practice.defaultSeverity,
          testCase.catalogSeverity,
          `fixture catalogSeverity ('${testCase.catalogSeverity}') must match ${practiceId}'s real catalog defaultSeverity ('${practice.defaultSeverity}'). Test case: ${testCase.name}`
        );
      }

      // Set up or clear the override in the practice config
      const overrideKey = isKindTest ? "kindOverride" : "severityOverride";
      const overrideValue = isKindTest ? testCase.kindOverride : testCase.severityOverride;

      let configRow = null;
      if (overrideValue !== null) {
        const stored = {};
        stored[overrideKey] = overrideValue;
        dbModule.stmts.upsertPlaybookPracticeConfig.run(practiceId, 1, JSON.stringify(stored));
        configRow = dbModule.stmts.getPlaybookPracticeConfig.get(practiceId);
      }

      // Call the resolver
      const resolved = resolvePracticeConfig(configRow, practice);

      // Assert the resolved value
      const field = isKindTest ? "kind" : "severity";
      const actual = resolved[field];
      const expected = testCase.expected;

      assert.equal(
        actual,
        expected,
        `resolvePracticeConfig(${practiceId}, override=${overrideValue}) should resolve to '${expected}' but got '${actual}'. Test case: ${testCase.name}`
      );

      // Clean up for next test
      if (configRow) {
        dbModule.db
          .prepare(`DELETE FROM playbook_practice_config WHERE practice_id = ?`)
          .run(practiceId);
      }
    }
  });

  it("coerces out-of-enum overrides to catalog defaults (fail-safe, never throws)", () => {
    // The "out-of-enum" case is present in caseTable — verify the resolver handles it
    const outOfEnumCase = caseTable.find(
      (c) => "kindOverride" in c && c.kindOverride === "bogus" && c.expected === c.catalogKind
    );
    assert(
      outOfEnumCase,
      "Expected an out-of-enum case in the fixture table (kindOverride='bogus', expected=catalog)"
    );

    const practice = PRACTICES.find((p) => p.id === "account-weekly-balance");
    const stored = { kindOverride: "bogus" };
    dbModule.stmts.upsertPlaybookPracticeConfig.run(practice.id, 1, JSON.stringify(stored));
    const row = dbModule.stmts.getPlaybookPracticeConfig.get(practice.id);

    // resolvePracticeConfig itself must not throw on an out-of-enum stored
    // override (only its own call is wrapped, so an assertion failure below
    // reports as an equality mismatch, not a misleading "Got unwanted
    // exception").
    let resolved;
    assert.doesNotThrow(() => {
      resolved = resolvePracticeConfig(row, practice);
    });
    // Should coerce back to catalog
    assert.equal(
      resolved.kind,
      practice.kind,
      "out-of-enum override should coerce to catalog kind, never throw"
    );
  });
});
