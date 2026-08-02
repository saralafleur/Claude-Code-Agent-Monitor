/**
 * @file accounts.test.js
 * @description Tests for the /api/accounts routes: same-origin guard
 * enforcement (mirrors server/__tests__/security.test.js's coverage of
 * /api/run and /api/usage, since /:id/capture makes a real outbound network
 * call with a live OAuth token), CRUD happy path, and the three credential
 * outcomes /:id/capture must handle without ever 500ing: a usable token
 * (persists a usage_captures row scoped to the account), an expired/missing
 * login (200 with an actionable "needs_login" status, no capture row), and
 * a usage-fetch failure (still persists an error-status capture row, same
 * as the legacy tmux capture path already does for its own failures). Also
 * covers POST /:id/login-terminal (the clickable "Needs login" badge): the
 * account's config_dir is what gets handed to terminal-focus, and the typed
 * failure codes map to their documented HTTP statuses. Also covers the
 * `last_used_at`/`is_active` fields (null with 0-1 captures, active once a
 * capture shows the percentage rose, unaffected by a later drop since a
 * drop is a window reset, not usage) — the underlying inference logic
 * (`pctIncreased`/`computeLastUsedAt`/`isAccountActive`) has its own
 * dedicated unit tests in account-activity.test.js.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `dashboard-accounts-test-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_REMOTE_SYNC_MS = "0";
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const { db } = require("../db");
const claudeCliCredentials = require("../lib/claude-cli-credentials");

let server;
let BASE;

function fetchJson(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...options.headers },
    };
    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}
const get = (p) => fetchJson(p);
const post = (p, body, headers) => fetchJson(p, { method: "POST", body, headers });
const del = (p) => fetchJson(p, { method: "DELETE" });

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
  if (db) db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

afterEach(() => {
  mock.restoreAll();
});

describe("/api/accounts same-origin guard", () => {
  it("rejects a cross-origin POST /:id/capture attempt", async () => {
    const res = await post(
      "/api/accounts/acct_whatever/capture",
      {},
      { Origin: "https://evil.example" }
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "EBADORIGIN");
  });

  it("allows a same-origin (no Origin header) GET", async () => {
    const res = await get("/api/accounts");
    assert.equal(res.status, 200);
  });
});

describe("/api/accounts CRUD", () => {
  let configDir;
  let createdId;

  before(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-acct-configdir-"));
  });
  after(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("starts empty", async () => {
    const res = await get("/api/accounts");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.accounts, []);
  });

  it("creates an account", async () => {
    const res = await post("/api/accounts", { label: "Work", configDir });
    assert.equal(res.status, 201);
    assert.equal(res.body.account.label, "Work");
    assert.equal(res.body.account.config_dir, configDir);
    assert.equal(res.body.account.enabled, true);
    assert.equal(res.body.account.status, "idle");
    assert.ok(res.body.account.id.startsWith("acct_"));
    createdId = res.body.account.id;
  });

  it("rejects a missing label", async () => {
    const res = await post("/api/accounts", { configDir: "/tmp/whatever" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "EBADLABEL");
  });

  it("rejects a configDir that doesn't exist", async () => {
    const res = await post("/api/accounts", { label: "Nope", configDir: "/definitely/not/here" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "ENOCONFIGDIR");
  });

  it("rejects a duplicate configDir", async () => {
    const res = await post("/api/accounts", { label: "Dup", configDir });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "EDUPLICATE");
  });

  it("404s capture for an unknown account id", async () => {
    const res = await post("/api/accounts/acct_nope/capture", {});
    assert.equal(res.status, 404);
  });

  it("deletes an account", async () => {
    const res = await del(`/api/accounts/${createdId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual((await get("/api/accounts")).body.accounts, []);
  });
});

describe("/api/accounts/:id/capture credential outcomes", () => {
  let configDir;
  let accountId;

  before(async () => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-acct-capture-"));
    const res = await post("/api/accounts", { label: "Capture Test", configDir });
    accountId = res.body.account.id;
  });
  after(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("needs_login when no CLI login exists for this config dir", async () => {
    mock.method(claudeCliCredentials, "readCredential", async () => ({
      status: "not_found",
      accountEmail: null,
      accountOrg: null,
    }));

    const res = await post(`/api/accounts/${accountId}/capture`, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "not_found");
    assert.equal(res.body.account.status, "needs_login");
    assert.ok(res.body.message);
  });

  it("persists an ok capture scoped to the account when the credential + fetch succeed", async () => {
    mock.method(claudeCliCredentials, "readCredential", async () => ({
      status: "ok",
      accessToken: "sk-ant-oat-fake",
      accountEmail: "work@example.com",
      accountOrg: "Acme",
    }));
    const usageFetchOauth = require("../lib/usage-fetch-oauth");
    mock.method(usageFetchOauth, "fetchUsageViaOAuth", async () => ({
      status: "ok",
      sessionWindowPct: 33,
      sessionWindowResetRaw: "2026-08-01T12:00:00.000Z",
      weekWindowPct: 61,
      weekResetRaw: "2026-08-05T00:00:00.000Z",
      httpStatus: 200,
      errorMessage: null,
    }));

    const res = await post(`/api/accounts/${accountId}/capture`, {});
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.account_id, accountId);
    assert.equal(res.body.account_email, "work@example.com");
    assert.equal(res.body.session_window_pct, 33);
    assert.equal(res.body.week_window_pct, 61);

    const list = await get(`/api/accounts`);
    const row = list.body.accounts.find((a) => a.id === accountId);
    assert.equal(row.status, "ok");
    assert.equal(row.account_email, "work@example.com");
    assert.equal(row.latest_session_window_pct, 33);
  });

  it("persists an error-status capture (not a 500) when the usage fetch itself fails", async () => {
    mock.method(claudeCliCredentials, "readCredential", async () => ({
      status: "ok",
      accessToken: "sk-ant-oat-fake",
      accountEmail: "work@example.com",
      accountOrg: "Acme",
    }));
    const usageFetchOauth = require("../lib/usage-fetch-oauth");
    mock.method(usageFetchOauth, "fetchUsageViaOAuth", async () => ({
      status: "error",
      sessionWindowPct: null,
      sessionWindowResetRaw: null,
      weekWindowPct: null,
      weekResetRaw: null,
      httpStatus: 401,
      errorMessage: "No rate-limit headers in response (HTTP 401)",
    }));

    const res = await post(`/api/accounts/${accountId}/capture`, {});
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "error");
    assert.match(res.body.error_message, /401/);

    const list = await get(`/api/accounts`);
    const row = list.body.accounts.find((a) => a.id === accountId);
    assert.equal(row.status, "error");
    assert.ok(row.last_error);
  });
});

describe("POST /api/accounts/:id/login-terminal", () => {
  const terminalFocus = require("../lib/terminal-focus");
  let configDir;
  let accountId;

  before(async () => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-acct-login-"));
    const res = await post("/api/accounts", { label: "Login Test", configDir });
    accountId = res.body.account.id;
  });
  after(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("404s for an unknown account id", async () => {
    const res = await post("/api/accounts/acct_nope/login-terminal", {});
    assert.equal(res.status, 404);
  });

  it("rejects a cross-origin attempt (it launches a real terminal)", async () => {
    const res = await post(
      `/api/accounts/${accountId}/login-terminal`,
      {},
      { Origin: "https://evil.example" }
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "EBADORIGIN");
  });

  it("opens a login terminal for the account's config dir and returns { ok: true }", async () => {
    let seenConfigDir;
    mock.method(terminalFocus, "openLoginTerminalForConfigDir", (dir) => {
      seenConfigDir = dir;
      return { ok: true };
    });
    const res = await post(`/api/accounts/${accountId}/login-terminal`, {});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(seenConfigDir, configDir);
  });

  it("maps each typed failure code to its documented HTTP status", async () => {
    const cases = [
      ["UNSUPPORTED_PLATFORM", 501],
      ["NO_CONFIG_DIR", 409],
      ["AUTOMATION_ERROR", 500],
    ];
    for (const [code, status] of cases) {
      mock.method(terminalFocus, "openLoginTerminalForConfigDir", () => ({
        ok: false,
        code,
        message: `msg:${code}`,
      }));
      const res = await post(`/api/accounts/${accountId}/login-terminal`, {});
      assert.equal(res.status, status, `${code} should map to ${status}`);
      assert.equal(res.body.error.code, code);
    }
  });
});

describe("account activity (last_used_at / is_active)", () => {
  let configDir;
  let accountId;

  before(async () => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-acct-activity-"));
    const res = await post("/api/accounts", { label: "Activity Test", configDir });
    accountId = res.body.account.id;
  });
  after(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  // The shared afterEach(mock.restoreAll()) above wipes any mock after the
  // test that set it up finishes, so — same as the credential-outcomes
  // block above — each test that needs a capture re-establishes its own
  // mocks rather than relying on a describe-level `before()`.
  async function captureWithPct(sessionPct) {
    mock.method(claudeCliCredentials, "readCredential", async () => ({
      status: "ok",
      accessToken: "sk-ant-oat-fake",
      accountEmail: "activity@example.com",
      accountOrg: null,
    }));
    const usageFetchOauth = require("../lib/usage-fetch-oauth");
    mock.method(usageFetchOauth, "fetchUsageViaOAuth", async () => ({
      status: "ok",
      sessionWindowPct: sessionPct,
      sessionWindowResetRaw: null,
      weekWindowPct: 0,
      weekResetRaw: null,
      httpStatus: 200,
      errorMessage: null,
    }));
    await post(`/api/accounts/${accountId}/capture`, {});
  }

  it("reports null last_used_at and inactive before any capture happens", async () => {
    const list = await get("/api/accounts");
    const row = list.body.accounts.find((a) => a.id === accountId);
    assert.equal(row.last_used_at, null);
    assert.equal(row.is_active, false);
  });

  it("still reports null after a single capture — nothing to diff against yet", async () => {
    await captureWithPct(10);

    const list = await get("/api/accounts");
    const row = list.body.accounts.find((a) => a.id === accountId);
    assert.equal(row.last_used_at, null);
    assert.equal(row.is_active, false);
  });

  it("reports active with a recent last_used_at once a capture shows the percentage rose", async () => {
    await captureWithPct(25); // rose from 10 → real quota consumption

    const list = await get("/api/accounts");
    const row = list.body.accounts.find((a) => a.id === accountId);
    assert.ok(row.last_used_at);
    assert.equal(row.is_active, true);
  });

  it("does not treat a percentage drop (a window reset) as fresh activity", async () => {
    const before = (await get("/api/accounts")).body.accounts.find(
      (a) => a.id === accountId
    ).last_used_at;

    await captureWithPct(0); // session window rolled over, not new usage

    const list = await get("/api/accounts");
    const row = list.body.accounts.find((a) => a.id === accountId);
    assert.equal(row.last_used_at, before);
  });
});

describe("GET /api/usage accountId filter", () => {
  it("scopes usage history to one account when accountId is passed", async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-acct-usagefilter-"));
    const created = await post("/api/accounts", { label: "Filter Test", configDir });
    const accountId = created.body.account.id;

    mock.method(claudeCliCredentials, "readCredential", async () => ({
      status: "ok",
      accessToken: "sk-ant-oat-fake",
      accountEmail: "filter@example.com",
      accountOrg: null,
    }));
    const usageFetchOauth = require("../lib/usage-fetch-oauth");
    mock.method(usageFetchOauth, "fetchUsageViaOAuth", async () => ({
      status: "ok",
      sessionWindowPct: 10,
      sessionWindowResetRaw: null,
      weekWindowPct: 20,
      weekResetRaw: null,
      httpStatus: 200,
      errorMessage: null,
    }));
    await post(`/api/accounts/${accountId}/capture`, {});

    const scoped = await get(`/api/usage?accountId=${accountId}`);
    assert.ok(scoped.body.items.length > 0);
    assert.ok(scoped.body.items.every((i) => i.account_id === accountId));

    const unscoped = await get(`/api/usage`);
    assert.ok(unscoped.body.items.some((i) => i.account_id === accountId));

    fs.rmSync(configDir, { recursive: true, force: true });
  });
});
