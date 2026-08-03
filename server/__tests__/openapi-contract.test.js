/**
 * @file Tests for OpenAPI contract: operationId uniqueness, route ↔ spec completeness,
 * namespace coverage (project-plans routes), and openapi.yaml freshness (O-19).
 * Derives everything from createOpenApiSpec() in server/openapi.js.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// R0 red: will fail if openapi.js doesn't export createOpenApiSpec
const openapi = require("../openapi");

// GRANDFATHERED_MOUNTS: the ONLY `app.use("/api/...")` mounts in
// server/index.js permitted to have zero matching path entry in the
// generated OpenAPI spec, each with a dated reason. Populated empirically
// (D2.2 regex-scans the real mount list against the real spec) — do not
// widen this list to make a real gap disappear; a new genuinely-undocumented
// mount needs its own reviewed entry, not silence.
const GRANDFATHERED_MOUNTS = [
  { mount: "/api/usage", reason: "undocumented since introduction, 2026-08-02" },
  { mount: "/api/accounts", reason: "undocumented since introduction, 2026-08-02" },
  { mount: "/api/focus-report", reason: "undocumented since introduction, 2026-08-02" },
  { mount: "/api/monitors", reason: "undocumented since introduction, 2026-08-02" },
  { mount: "/api/color-thresholds", reason: "undocumented since introduction, 2026-08-02" },
];

describe("OpenAPI contract (D2 / O-19)", () => {
  it("D2.1: operationId uniqueness — no collisions, failure message names colliding pair", () => {
    const spec = openapi.createOpenApiSpec();
    const operationIds = new Set();
    let collisions = [];

    for (const [path, pathItem] of Object.entries(spec.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (typeof operation === "object" && operation.operationId) {
          if (operationIds.has(operation.operationId)) {
            collisions.push(operation.operationId);
          }
          operationIds.add(operation.operationId);
        }
      }
    }

    assert.equal(collisions.length, 0, `operationId collisions: ${collisions.join(", ")}`);
  });

  it("D2.2: mount ↔ path completeness modulo GRANDFATHERED_MOUNTS (do not widen this list)", () => {
    assert.equal(
      GRANDFATHERED_MOUNTS.length,
      5,
      "GRANDFATHERED_MOUNTS grew — a new undocumented mount needs its own reviewed entry, not silent widening"
    );

    const indexSrc = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const mountRe = /app\.use\(\s*"(\/api\/[a-z0-9-]+)"/g;
    const mounts = new Set();
    let m;
    while ((m = mountRe.exec(indexSrc))) {
      if (m[1] === "/api") continue; // the token-guard middleware, not a router mount
      mounts.add(m[1]);
    }
    assert.ok(mounts.size > 0, "regex found no app.use mounts — server/index.js shape changed");

    const spec = openapi.createOpenApiSpec();
    const specPaths = Object.keys(spec.paths || {});
    const grandfathered = new Set(GRANDFATHERED_MOUNTS.map((g) => g.mount));

    const undocumented = [];
    for (const mount of mounts) {
      const hasPath = specPaths.some((p) => p === mount || p.startsWith(`${mount}/`));
      if (!hasPath && !grandfathered.has(mount)) undocumented.push(mount);
    }
    assert.deepEqual(
      undocumented,
      [],
      `mount(s) with zero OpenAPI path entry and no GRANDFATHERED_MOUNTS reason: ${undocumented.join(", ")}`
    );

    // Every grandfathered entry must still actually be missing — a stale
    // "grandfathered" row hiding a mount that got documented is exactly the
    // kind of silent drift this test exists to catch.
    for (const g of GRANDFATHERED_MOUNTS) {
      const hasPath = specPaths.some((p) => p === g.mount || p.startsWith(`${g.mount}/`));
      assert.equal(
        hasPath,
        false,
        `${g.mount} is grandfathered as undocumented but now has a spec path — remove its entry`
      );
    }
  });

  it("D2.3: new namespace fully specced (pool, health, history, import, items, claims, :id, :id/close all have operationIds)", () => {
    const spec = openapi.createOpenApiSpec();
    const paths = spec.paths || {};

    const requiredWithOperationId = [
      ["/api/project-plans", "get"],
      ["/api/project-plans", "post"],
      ["/api/project-plans/pool", "get"],
      ["/api/project-plans/health", "get"],
      ["/api/project-plans/history", "get"],
      ["/api/project-plans/import", "post"],
    ];
    for (const [p, method] of requiredWithOperationId) {
      const entry = paths[p];
      assert.ok(entry, `path ${p} must exist in spec`);
      assert.ok(entry[method], `${method.toUpperCase()} ${p} must exist in spec`);
      assert.ok(entry[method].operationId, `${method.toUpperCase()} ${p} must have an operationId`);
    }

    // :id / :id/close / items / claims live under path-parameter templates —
    // find them by suffix rather than assuming Express's exact param name.
    const suffixesNeedingOperationId = ["/close", "/items", "/claims"];
    for (const suffix of suffixesNeedingOperationId) {
      const matches = Object.keys(paths).filter(
        (p) => p.startsWith("/api/project-plans/") && p.endsWith(suffix)
      );
      assert.ok(
        matches.length > 0,
        `no spec path found ending in ${suffix} under /api/project-plans`
      );
      for (const p of matches) {
        for (const [, operation] of Object.entries(paths[p])) {
          if (typeof operation === "object") {
            assert.ok(operation.operationId, `${p} operation must have an operationId`);
          }
        }
      }
    }

    // A bare /api/project-plans/{id}-shaped path (GET one plan) must exist too.
    const idPaths = Object.keys(paths).filter((p) => /^\/api\/project-plans\/\{[^}]+\}$/.test(p));
    assert.ok(idPaths.length > 0, "no /api/project-plans/{id} path found in spec");
  });

  it("D2.4: openapi.yaml round-trip — committed yaml equals regenerated dump (exactly what scripts/generate-openapi-yaml.js does)", () => {
    const spec = openapi.createOpenApiSpec();
    const body = yaml.dump(spec, { lineWidth: -1, noRefs: true, sortKeys: false });
    const header =
      "# DO NOT EDIT BY HAND. Generated from server/openapi.js via `npm run openapi:yaml`.\n" +
      "# This YAML mirrors the live spec served at GET /api/openapi.json.\n";
    const regenerated = header + body;

    const yamlPath = path.join(__dirname, "..", "..", "openapi.yaml");
    assert.ok(fs.existsSync(yamlPath), "openapi.yaml must exist at the repo root");
    const committed = fs.readFileSync(yamlPath, "utf8");
    assert.equal(regenerated, committed, "Run `npm run openapi:yaml` and commit the result");
  });
});
