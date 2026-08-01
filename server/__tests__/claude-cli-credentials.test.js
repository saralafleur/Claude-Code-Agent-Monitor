/**
 * @file claude-cli-credentials.test.js
 * @description Unit tests for server/lib/claude-cli-credentials.js: the
 * Keychain service-name derivation, the macOS Keychain read path (with
 * `child_process.execFile` mocked so no real Keychain is touched), the
 * non-macOS file-based fallback path, and every credential status
 * (ok/expired/not_found/invalid).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");

const creds = require("../lib/claude-cli-credentials");

afterEach(() => {
  mock.restoreAll();
});

describe("__computeServiceName", () => {
  it("uses the fixed default service name for ~/.claude", () => {
    const defaultDir = path.join(os.homedir(), ".claude");
    assert.equal(creds.__computeServiceName(defaultDir), "Claude Code-credentials");
  });

  it("suffixes a custom config dir with the first 8 hex chars of its SHA-256", () => {
    const dir = path.resolve(os.homedir(), ".claude-accounts", "work");
    const expectedHash = crypto.createHash("sha256").update(dir).digest("hex").slice(0, 8);
    assert.equal(creds.__computeServiceName(dir), `Claude Code-credentials-${expectedHash}`);
  });
});

describe("readCredential - macOS Keychain path", () => {
  function mockSecurity(implementation) {
    mock.method(cp, "execFile", implementation);
  }

  it("returns ok with the access token for a fresh, valid credential", async () => {
    const payload = JSON.stringify({
      claudeAiOauth: {
        accessToken: "sk-ant-oat-fake",
        refreshToken: "sk-ant-ort-fake",
        expiresAt: Date.now() + 60_000,
        subscriptionType: "max",
      },
    });
    mockSecurity((_cmd, _args, _opts, cb) => cb(null, payload + "\n", ""));

    const result = await creds.readCredential("~/.claude", { platform: "darwin" });
    assert.equal(result.status, "ok");
    assert.equal(result.accessToken, "sk-ant-oat-fake");
    assert.equal(result.subscriptionType, "max");
  });

  it("returns expired with a null access token when expiresAt has passed", async () => {
    const payload = JSON.stringify({
      claudeAiOauth: {
        accessToken: "sk-ant-oat-fake",
        refreshToken: "sk-ant-ort-fake",
        expiresAt: Date.now() - 60_000,
      },
    });
    mockSecurity((_cmd, _args, _opts, cb) => cb(null, payload, ""));

    const result = await creds.readCredential("~/.claude-accounts/work", { platform: "darwin" });
    assert.equal(result.status, "expired");
    assert.equal(result.accessToken, null);
  });

  it("returns not_found when the Keychain has no matching entry", async () => {
    mockSecurity((_cmd, _args, _opts, cb) => cb(new Error("security: item not found"), "", ""));

    const result = await creds.readCredential("~/.claude-accounts/missing", { platform: "darwin" });
    assert.equal(result.status, "not_found");
  });

  it("returns invalid when the Keychain entry isn't parseable JSON", async () => {
    mockSecurity((_cmd, _args, _opts, cb) => cb(null, "not json", ""));

    const result = await creds.readCredential("~/.claude", { platform: "darwin" });
    assert.equal(result.status, "invalid");
  });

  it("returns invalid when required OAuth fields are missing", async () => {
    mockSecurity((_cmd, _args, _opts, cb) => cb(null, JSON.stringify({ claudeAiOauth: {} }), ""));

    const result = await creds.readCredential("~/.claude", { platform: "darwin" });
    assert.equal(result.status, "invalid");
  });
});

describe("readCredential - non-macOS file fallback", () => {
  let dir;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reads a valid .credentials.json file", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-cli-creds-"));
    fs.writeFileSync(
      path.join(dir, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: { accessToken: "sk-ant-oat-linux", expiresAt: Date.now() + 60_000 },
      })
    );

    const result = await creds.readCredential(dir, { platform: "linux" });
    assert.equal(result.status, "ok");
    assert.equal(result.accessToken, "sk-ant-oat-linux");
  });

  it("returns not_found when no credentials file exists", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-cli-creds-"));
    const result = await creds.readCredential(dir, { platform: "linux" });
    assert.equal(result.status, "not_found");
  });
});

describe("readCredential - account display metadata", () => {
  it("best-effort reads oauthAccount from .claude.json alongside a not_found credential", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-cli-meta-"));
    fs.writeFileSync(
      path.join(dir, ".claude.json"),
      JSON.stringify({
        oauthAccount: { emailAddress: "work@example.com", organizationName: "Acme" },
      })
    );
    try {
      const result = await creds.readCredential(dir, { platform: "linux" });
      assert.equal(result.status, "not_found");
      assert.equal(result.accountEmail, "work@example.com");
      assert.equal(result.accountOrg, "Acme");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("degrades to null account fields when .claude.json is missing or malformed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-cli-meta-"));
    try {
      const result = await creds.readCredential(dir, { platform: "linux" });
      assert.equal(result.accountEmail, null);
      assert.equal(result.accountOrg, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
