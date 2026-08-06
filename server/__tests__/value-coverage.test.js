/**
 * @file Tests for server/lib/value-coverage.js — the single home (DEC-5,
 * §9.1) for Value Pool Slice 2's coverage/ETA computation. Covers
 * `coverageSnapshot`'s arithmetic (described/pending/complete), all three
 * `demand` states, and all three `estimateEta` state branches
 * (measured/estimating/none), including the cold-start "no fabricated
 * number" requirement (G1a).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const TEST_DB = path.join(
  os.tmpdir(),
  `dashboard-value-coverage-test-${Date.now()}-${process.pid}.db`
);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const dbModule = require("../db");
const { db, stmts } = dbModule;
const {
  coverageSnapshot,
  estimateEta,
  DEMAND_STATES,
  ETA_STATES,
  ETA_SAMPLE_SIZE,
} = require("../lib/value-coverage");

function counts(overrides = {}) {
  return {
    pool_size: 10,
    cache_hits: 5,
    generated: 0,
    queued: 3,
    unavailable: 2,
    stale_regenerated: 0,
    ...overrides,
  };
}

let nextProjectSuffix = 0;
function freshProjectId() {
  nextProjectSuffix += 1;
  return `value-coverage-test-${Date.now()}-${process.pid}-${nextProjectSuffix}`;
}

function seedGenerationRow(projectId, { durationMs, generated = 10, daysAgo = 0 }) {
  stmts.insertValueSummaryGeneration.run(
    projectId,
    "tick",
    "ok",
    generated + 2,
    2,
    generated,
    0,
    0,
    "haiku",
    durationMs,
    0
  );
  db.prepare(
    "UPDATE value_summary_generation_log SET created_at = ? WHERE project_id = ? AND id = (SELECT MAX(id) FROM value_summary_generation_log WHERE project_id = ?)"
  ).run(new Date(Date.now() - daysAgo * 86_400_000).toISOString(), projectId, projectId);
}

beforeEach(() => {
  db.exec("DELETE FROM value_summary_generation_log");
});

describe("coverageSnapshot arithmetic (§9.1 single home)", () => {
  it("described = pool_size - queued - unavailable", () => {
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts({ pool_size: 10, queued: 3, unavailable: 2 }),
      requestedAt: null,
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(snap.described, 5);
  });

  it("pending = queued + unavailable", () => {
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts({ queued: 3, unavailable: 2 }),
      requestedAt: null,
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(snap.pending, 5);
  });

  it("complete === true iff pending === 0", () => {
    const incomplete = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts({ queued: 1, unavailable: 0 }),
      requestedAt: null,
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(incomplete.complete, false);

    const complete = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts({ pool_size: 10, cache_hits: 10, queued: 0, unavailable: 0 }),
      requestedAt: null,
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(complete.complete, true);
  });

  it("pool_size is carried verbatim from counts.pool_size", () => {
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts({ pool_size: 182 }),
      requestedAt: null,
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(snap.pool_size, 182);
  });

  it("computed_at and project_id are carried through verbatim", () => {
    const projectId = freshProjectId();
    const snap = coverageSnapshot(dbModule, {
      projectId,
      counts: counts(),
      requestedAt: null,
      draining: false,
      computedAt: "2026-08-05T09:30:00.000Z",
    });
    assert.equal(snap.project_id, projectId);
    assert.equal(snap.computed_at, "2026-08-05T09:30:00.000Z");
  });
});

describe("coverageSnapshot demand states (G1b — three distinguishable buckets)", () => {
  it("DEMAND_STATES is the closed three-entry registry", () => {
    assert.deepEqual(DEMAND_STATES, ["passive", "requested", "draining"]);
  });

  it("demand === 'passive' when requestedAt is null", () => {
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts(),
      requestedAt: null,
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(snap.demand, "passive");
  });

  it("demand === 'requested' when requestedAt is set but draining is false", () => {
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts(),
      requestedAt: "2026-08-05T08:00:00.000Z",
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(snap.demand, "requested");
  });

  it("demand === 'draining' when requestedAt is set and draining is true", () => {
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts(),
      requestedAt: "2026-08-05T08:00:00.000Z",
      draining: true,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(snap.demand, "draining");
  });

  it("never-zero direction: a flag kept on a no-progress exit still reads 'requested', never 'passive' (§9.8)", () => {
    // Simulates the no-progress exit condition: coverage_requested_at is
    // still set (the tick kept the flag per DEC-8), draining=false because
    // this particular snapshot call happens between drain attempts.
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts({ queued: 5, unavailable: 0 }),
      requestedAt: "2026-08-04T00:00:00.000Z", // still set, not cleared
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.notEqual(
      snap.demand,
      "passive",
      "a kept flag must never silently collapse into the same absence as 'never requested'"
    );
    assert.equal(snap.demand, "requested");
  });
});

describe("estimateEta state branches (G1a)", () => {
  it("ETA_STATES is the closed three-entry registry", () => {
    assert.deepEqual(ETA_STATES, ["measured", "estimating", "none"]);
  });

  it("state === 'none' when pending is 0 (coverage already complete)", () => {
    const eta = estimateEta(dbModule, { projectId: freshProjectId(), pending: 0 });
    assert.deepEqual(eta, { state: "none" });
  });

  it("cold start: pending > 0 but zero qualifying rows anywhere → 'estimating', no fabricated number", () => {
    const eta = estimateEta(dbModule, { projectId: freshProjectId(), pending: 5 });
    assert.equal(eta.state, "estimating");
    assert.equal(
      eta.ms_remaining,
      undefined,
      "estimating state must not carry a fabricated ms_remaining — a rendered ~0 min is a requirement violation"
    );
  });

  it("'measured': per-project history yields a real ms_remaining/per_batch_ms/batches_remaining", () => {
    const projectId = freshProjectId();
    seedGenerationRow(projectId, { durationMs: 4000, daysAgo: 1 });
    seedGenerationRow(projectId, { durationMs: 6000, daysAgo: 2 });
    const eta = estimateEta(dbModule, { projectId, pending: 45 });
    assert.equal(eta.state, "measured");
    // avg(4000,6000) = 5000; batchesRemaining = ceil(45/40) = 2
    assert.equal(eta.per_batch_ms, 5000);
    assert.equal(eta.batches_remaining, 2);
    assert.equal(eta.ms_remaining, 10000);
  });

  it("falls back to fleet-wide history when the project has none of its own", () => {
    const fleetProject = freshProjectId();
    seedGenerationRow(fleetProject, { durationMs: 8000, daysAgo: 1 });
    const coldProject = freshProjectId();
    const eta = estimateEta(dbModule, { projectId: coldProject, pending: 10 });
    assert.equal(eta.state, "measured");
    assert.equal(eta.per_batch_ms, 8000);
  });

  it("prefers per-project history over the fleet-wide fallback when both exist", () => {
    const fleetProject = freshProjectId();
    seedGenerationRow(fleetProject, { durationMs: 100000, daysAgo: 1 });
    const projectId = freshProjectId();
    seedGenerationRow(projectId, { durationMs: 2000, daysAgo: 1 });
    const eta = estimateEta(dbModule, { projectId, pending: 10 });
    assert.equal(eta.per_batch_ms, 2000, "must use the project's own history, not the fleet's");
  });

  it("uses at most ETA_SAMPLE_SIZE (K=5) most-recent rows", () => {
    const projectId = freshProjectId();
    // 7 rows: 5 recent at 1000ms, 2 old at 100000ms — average must reflect
    // only the 5 most recent (K=5), never the two oldest outliers.
    for (let i = 0; i < 5; i++) {
      seedGenerationRow(projectId, { durationMs: 1000, daysAgo: i });
    }
    seedGenerationRow(projectId, { durationMs: 100000, daysAgo: 10 });
    seedGenerationRow(projectId, { durationMs: 100000, daysAgo: 11 });
    const eta = estimateEta(dbModule, { projectId, pending: 5 });
    assert.equal(ETA_SAMPLE_SIZE, 5);
    assert.equal(eta.per_batch_ms, 1000, "average must exclude rows beyond the K=5 sample window");
  });

  it("no pool-membership SQL: estimateEta's only DB reads are the duration statements (DEC-16)", () => {
    // Structural sentinel, not just behavioral: value-coverage.js's own
    // source must contain no FROM project_paths / detour_dispositions / a
    // hand-rolled pool query.
    const source = fs.readFileSync(path.resolve(__dirname, "../lib/value-coverage.js"), "utf8");
    assert.doesNotMatch(source, /FROM\s+project_paths/i);
    assert.doesNotMatch(source, /FROM\s+detour_dispositions/i);
    assert.doesNotMatch(source, /assembleValuePool\s*\(/);
    assert.doesNotMatch(source, /require\(["']\.\/value-ledger["']\)/);
  });
});

describe("i18n registry → locale (WATCH-S2-F, G6): every DEMAND_STATES/ETA_STATES member has a client copy in all four locales", () => {
  // Mirrors value-summary.test.js's "every ALTITUDE_STATES member has a
  // planLedger.pool.altitudes key" precedent. Not every registry value maps
  // to a locale key of the SAME name (e.g. eta.state "measured" renders via
  // the "etaRemaining" interpolated string, not a literal "measured" key) —
  // this explicit map is the deliberate, reviewed correspondence, not a
  // guess.
  const STATE_TO_LOCALE_KEY = {
    demand: {
      // "passive" has no dedicated copy — the header renders with no extra
      // demand string when nothing is requested.
      requested: "requested",
      draining: "draining",
    },
    eta: {
      measured: "etaRemaining",
      estimating: "estimating",
      // "none" (already complete) has no dedicated copy either.
    },
  };

  it("N2: the STATE_TO_LOCALE_KEY exemption set (registry members with NO locale key) is exactly the reviewed closed set, not silently permissive", () => {
    const exemptDemand = DEMAND_STATES.filter((s) => !STATE_TO_LOCALE_KEY.demand[s]);
    assert.deepEqual(
      exemptDemand,
      ["passive"],
      "DEMAND_STATES exemption set must be exactly ['passive']"
    );

    const exemptEta = ETA_STATES.filter((s) => !STATE_TO_LOCALE_KEY.eta[s]);
    assert.deepEqual(exemptEta, ["none"], "ETA_STATES exemption set must be exactly ['none']");
  });

  for (const locale of ["en", "ko", "vi", "zh"]) {
    it(`${locale}/projectDetail.json has every mapped DEMAND_STATES/ETA_STATES key under planLedger.pool.coverage`, () => {
      const localeJson = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, `../../client/src/i18n/locales/${locale}/projectDetail.json`),
          "utf8"
        )
      );
      const bucket = localeJson.planLedger.pool.coverage;
      assert.ok(
        bucket,
        `${locale}/projectDetail.json is missing planLedger.pool.coverage entirely`
      );

      for (const demandState of DEMAND_STATES) {
        const key = STATE_TO_LOCALE_KEY.demand[demandState];
        if (!key) continue; // deliberately uncopied state (e.g. "passive")
        assert.ok(
          Object.prototype.hasOwnProperty.call(bucket, key),
          `DEMAND_STATES member "${demandState}" has no planLedger.pool.coverage.${key} copy in ${locale}/projectDetail.json`
        );
      }
      for (const etaState of ETA_STATES) {
        const key = STATE_TO_LOCALE_KEY.eta[etaState];
        if (!key) continue; // deliberately uncopied state (e.g. "none")
        assert.ok(
          Object.prototype.hasOwnProperty.call(bucket, key),
          `ETA_STATES member "${etaState}" has no planLedger.pool.coverage.${key} copy in ${locale}/projectDetail.json`
        );
      }
      // Also required regardless of registry membership: the button label.
      assert.ok(
        Object.prototype.hasOwnProperty.call(bucket, "prioritizeNow"),
        `${locale}/projectDetail.json is missing planLedger.pool.coverage.prioritizeNow`
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(bucket, "header"),
        `${locale}/projectDetail.json is missing planLedger.pool.coverage.header`
      );
    });
  }
});

describe("coverageSnapshot end-to-end: eta rides along in the same object", () => {
  it("a coverageSnapshot call with pending > 0 and no history surfaces the cold-start eta", () => {
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts({ queued: 4, unavailable: 0 }),
      requestedAt: "2026-08-05T00:00:00.000Z",
      draining: true,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(snap.eta.state, "estimating");
  });

  it("a complete snapshot (pending === 0) surfaces eta.state === 'none'", () => {
    const snap = coverageSnapshot(dbModule, {
      projectId: freshProjectId(),
      counts: counts({ pool_size: 6, cache_hits: 6, queued: 0, unavailable: 0 }),
      requestedAt: null,
      draining: false,
      computedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(snap.eta.state, "none");
  });
});
