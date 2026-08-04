/// <reference types="node" />
/**
 * @file T8 client half: draft resolver parity test.
 * Drives the shared case table through both resolveDraftKind and resolveDraftSeverity,
 * asserting identical results to the server's resolvePracticeConfig() for parity rows.
 *
 * NOTE: Both server and client resolve through the same formula:
 *   (draft !== undefined ? draft : p.override) ?? p.catalog
 *
 * This file tests:
 * - Parity rows (serverApplicable=true): must match server results
 * - Draft-only rows (serverApplicable=false): tested against assumed formula here;
 *   server has no draft concept and these rows are not run through it
 *
 * `serverApplicable=true` rows are also covered by
 * server/__tests__/playbook-resolver-parity.test.js's server half, driven
 * through the same shared fixture — this file's loop over the full case
 * table (both applicable and draft-only rows) subsumes any narrower
 * "parity-only" pass, so there is no separate parity-only test here.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { resolveDraftKind, resolveDraftSeverity } from "../playbookStore";
import type { PlaybookPractice, ObservationKind, ObservationSeverity } from "../types";

// Load the shared case table
const caseTablePath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "server",
  "__tests__",
  "fixtures",
  "playbook-resolution-cases.json"
);
const caseTable = JSON.parse(fs.readFileSync(caseTablePath, "utf8"));

describe("Resolver parity: client-side resolveDraftKind/resolveDraftSeverity (T8 client half)", () => {
  it("drives every case through resolveDraftKind, asserting correct resolved values", () => {
    const kindCases = caseTable.filter((c: any) => "catalogKind" in c);
    expect(kindCases.length).toBeGreaterThan(0);

    for (const testCase of kindCases) {
      // Map the "__UNSET__" sentinel to undefined
      const draft = testCase.draft === "__UNSET__" ? undefined : testCase.draft;

      // Construct a PlaybookPractice-shaped object with the test case values
      const practice: PlaybookPractice = {
        id: "test-practice",
        category: "test",
        scope: "global" as const,
        enabled: true,
        kind: testCase.catalogKind as ObservationKind,
        kindOverride: testCase.kindOverride as ObservationKind | null,
        defaultSeverity: "info" as ObservationSeverity,
        severityOverride: null,
        resolvedKind: testCase.expected as ObservationKind,
        resolvedSeverity: "info" as ObservationSeverity,
        fields: [],
        config: {},
      };

      const actual = resolveDraftKind(practice, draft);
      expect(actual, `Test case: ${testCase.name}`).toBe(testCase.expected);
    }
  });

  it("drives every case through resolveDraftSeverity, asserting correct resolved values", () => {
    const severityCases = caseTable.filter((c: any) => "catalogSeverity" in c);
    expect(severityCases.length).toBeGreaterThan(0);

    for (const testCase of severityCases) {
      // Map the "__UNSET__" sentinel to undefined
      const draft = testCase.draft === "__UNSET__" ? undefined : testCase.draft;

      // Construct a PlaybookPractice-shaped object with the test case values
      const practice: PlaybookPractice = {
        id: "test-practice",
        category: "test",
        scope: "global" as const,
        enabled: true,
        kind: "info" as ObservationKind,
        kindOverride: null,
        defaultSeverity: testCase.catalogSeverity as ObservationSeverity,
        severityOverride: testCase.severityOverride as ObservationSeverity | null,
        resolvedKind: "info" as ObservationKind,
        resolvedSeverity: testCase.expected as ObservationSeverity,
        fields: [],
        config: {},
      };

      const actual = resolveDraftSeverity(practice, draft);
      expect(actual, `Test case: ${testCase.name}`).toBe(testCase.expected);
    }
  });
});
