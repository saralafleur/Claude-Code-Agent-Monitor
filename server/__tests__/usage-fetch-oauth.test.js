/**
 * @file usage-fetch-oauth.test.js
 * @description Unit tests for server/lib/usage-fetch-oauth.js. Mocks the
 * global `fetch` so no real network call is made — covers a 200 response
 * carrying rate-limit headers, a 429 (rate-limited) response that still
 * carries the same headers, and a response with no usage headers at all
 * (e.g. a 401 from a revoked token), plus the percentage/reset unit
 * conversions.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  fetchUsageViaOAuth,
  __pctFromUtilization,
  __resetIsoFromEpochSeconds,
} = require("../lib/usage-fetch-oauth");

afterEach(() => {
  mock.restoreAll();
});

function mockFetchResponse({ status = 200, headers = {}, body = "{}" } = {}) {
  mock.method(globalThis, "fetch", async () => new Response(body, { status, headers }));
}

describe("unit conversions", () => {
  it("converts a 0-1 utilization fraction to a 0-100 percentage", () => {
    assert.equal(__pctFromUtilization("0.42"), 42);
    assert.equal(__pctFromUtilization("0.5"), 50);
    assert.equal(__pctFromUtilization("not-a-number"), null);
  });

  it("converts epoch seconds to an ISO reset string", () => {
    assert.equal(
      __resetIsoFromEpochSeconds("1735689600"),
      new Date(1735689600 * 1000).toISOString()
    );
    assert.equal(__resetIsoFromEpochSeconds("0"), null);
    assert.equal(__resetIsoFromEpochSeconds("nope"), null);
  });
});

describe("fetchUsageViaOAuth", () => {
  it("parses session + weekly percentages and resets from a 200 response", async () => {
    mockFetchResponse({
      status: 200,
      headers: {
        "anthropic-ratelimit-unified-5h-utilization": "0.31",
        "anthropic-ratelimit-unified-5h-reset": "1735689600",
        "anthropic-ratelimit-unified-7d-utilization": "0.64",
        "anthropic-ratelimit-unified-7d-reset": "1736294400",
      },
    });

    const result = await fetchUsageViaOAuth("sk-ant-oat-fake");
    assert.equal(result.status, "ok");
    assert.equal(result.sessionWindowPct, 31);
    assert.equal(result.weekWindowPct, 64);
    assert.equal(result.sessionWindowResetRaw, new Date(1735689600 * 1000).toISOString());
    assert.equal(result.weekResetRaw, new Date(1736294400 * 1000).toISOString());
    assert.equal(result.httpStatus, 200);
  });

  it("still parses usage headers off a 429 (rate-limited) response", async () => {
    mockFetchResponse({
      status: 429,
      headers: {
        "anthropic-ratelimit-unified-5h-utilization": "1.0",
        "anthropic-ratelimit-unified-7d-utilization": "0.88",
      },
    });

    const result = await fetchUsageViaOAuth("sk-ant-oat-fake");
    assert.equal(result.status, "ok");
    assert.equal(result.sessionWindowPct, 100);
    assert.equal(result.weekWindowPct, 88);
    assert.equal(result.httpStatus, 429);
  });

  it("reports error when the response has no usage headers (e.g. revoked token)", async () => {
    mockFetchResponse({ status: 401, headers: {}, body: '{"error":"unauthorized"}' });

    const result = await fetchUsageViaOAuth("sk-ant-oat-revoked");
    assert.equal(result.status, "error");
    assert.equal(result.sessionWindowPct, null);
    assert.equal(result.weekWindowPct, null);
    assert.equal(result.httpStatus, 401);
    assert.match(result.errorMessage, /401/);
  });

  it("reports error when the network request itself throws", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new Error("getaddrinfo ENOTFOUND api.anthropic.com");
    });

    const result = await fetchUsageViaOAuth("sk-ant-oat-fake");
    assert.equal(result.status, "error");
    assert.equal(result.httpStatus, null);
    assert.match(result.errorMessage, /ENOTFOUND/);
  });
});
