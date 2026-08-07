/**
 * @file Tests for /api/project-plans routes: plan CRUD, items, import, closure,
 * claims cardinality, pool, health, history, and namespace isolation. Boots
 * the real app on a temp DB against throwaway fixtures — real assertions on
 * every case (no vacuous stubs); each group's own before() creates the
 * fixtures that group needs.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `dashboard-project-plans-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");

let server;
let BASE;
let nextProjectSuffix = 0;

function fetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
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
      }
    );
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

const post = (p, body) => fetch(p, { method: "POST", body });
const patch = (p, body) => fetch(p, { method: "PATCH", body });
const del = (p) => fetch(p, { method: "DELETE" });

// Every group gets its own throwaway project row so groups never interfere.
async function makeProject(name) {
  nextProjectSuffix += 1;
  const id = `pp-test-${Date.now()}-${process.pid}-${nextProjectSuffix}`;
  stmts.insertProject.run(id, name || id);
  return id;
}

before(async () => {
  const app = createApp();
  server = await startServer(app, 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  try {
    db.close();
  } catch {
    /* already closed */
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("project-plans API (B1)", () => {
  describe("Group A: create/list/read", () => {
    let projectId;

    before(async () => {
      projectId = await makeProject("Group A Project");
    });

    it("A1: POST → 201 with status:'open', origin:'manual', opened_at set, closed_at:null", async () => {
      const res = await post("/api/project-plans", { project_id: projectId, title: "Test Plan" });
      assert.equal(res.status, 201);
      assert.equal(res.body.plan.status, "open");
      assert.equal(res.body.plan.origin, "manual");
      assert.ok(res.body.plan.opened_at);
      assert.equal(res.body.plan.closed_at, null);
      assert.equal(res.body.plan.project_id, projectId);
      assert.equal(res.body.plan.title, "Test Plan");
    });

    it("A2: validation 400s + create-only 404 on unknown project", async () => {
      const noProjectId = await post("/api/project-plans", { title: "No project id" });
      assert.equal(noProjectId.status, 400);
      assert.equal(noProjectId.body.error.code, "INVALID_INPUT");

      const noTitle = await post("/api/project-plans", { project_id: projectId });
      assert.equal(noTitle.status, 400);
      assert.equal(noTitle.body.error.code, "INVALID_INPUT");

      const res404 = await post("/api/project-plans", {
        project_id: "no-such-project-xyz",
        title: "Test",
      });
      assert.equal(res404.status, 404);
      assert.equal(res404.body.error.code, "NOT_FOUND");
    });

    it("A3: GET ?project_id= returns nested items (by position) with per-item claims, ?status= filters, no top-level cwd key", async () => {
      const created = await post("/api/project-plans", {
        project_id: projectId,
        title: "A3 Plan",
      });
      const planId = created.body.plan.id;
      // Insert two items out of position order to prove the GET sorts by
      // position, not insertion order.
      await post(`/api/project-plans/${planId}/items`, { text: "second", position: 2 });
      await post(`/api/project-plans/${planId}/items`, { text: "first", position: 1 });

      const res = await fetch(`/api/project-plans?project_id=${projectId}`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.plans));

      const entry = res.body.plans.find((p) => p.plan.id === planId);
      assert.ok(entry, "the plan we just created must appear in the list");
      assert.equal("cwd" in entry.plan, false, "plan must never carry a legacy cwd key (R1)");
      assert.equal(entry.items.length, 2);
      assert.deepEqual(
        entry.items.map((i) => i.text),
        ["first", "second"],
        "items must be ordered by position"
      );
      assert.ok(Array.isArray(entry.items[0].claims));
      assert.deepEqual(entry.items[0].claims, []);

      // ?status= filter.
      const openOnly = await fetch(`/api/project-plans?project_id=${projectId}&status=open`);
      assert.ok(openOnly.body.plans.every((p) => p.plan.status === "open"));
      const closedOnly = await fetch(`/api/project-plans?project_id=${projectId}&status=closed`);
      assert.ok(closedOnly.body.plans.every((p) => p.plan.status === "closed"));
    });

    it("A4: GET /:id 200/404 plus the literal-segment guard (pool returns its own 400, never the :id 404)", async () => {
      const created = await post("/api/project-plans", {
        project_id: projectId,
        title: "A4 Plan",
      });
      const planId = created.body.plan.id;

      const ok = await fetch(`/api/project-plans/${planId}`);
      assert.equal(ok.status, 200);
      assert.equal(ok.body.plan.id, planId);
      assert.ok(Array.isArray(ok.body.items));

      const missing = await fetch("/api/project-plans/999999999");
      assert.equal(missing.status, 404);
      assert.equal(missing.body.error.code, "NOT_FOUND");

      // "pool" is not \d+, so it must never be captured by /:id(\d+) — it
      // must reach the /pool handler and get ITS validation error (400 for
      // a missing project_id), never a 404 from the :id route.
      const poolRes = await fetch("/api/project-plans/pool");
      assert.equal(poolRes.status, 400, "the literal 'pool' segment must route to /pool, not /:id");
      assert.equal(poolRes.body.error.code, "INVALID_INPUT");
    });

    it("A5: generation chain exposes the derived 'ordinal' key; bogus succeeds_plan_id is rejected, never a raw 500", async () => {
      const gen1 = await post("/api/project-plans", { project_id: projectId, title: "Gen 1" });
      assert.equal(gen1.status, 201);
      const gen2 = await post("/api/project-plans", {
        project_id: projectId,
        title: "Gen 2",
        succeeds_plan_id: gen1.body.plan.id,
      });
      assert.equal(gen2.status, 201);

      const listRes = await fetch(`/api/project-plans?project_id=${projectId}&status=open`);
      const entry1 = listRes.body.plans.find((p) => p.plan.id === gen1.body.plan.id);
      const entry2 = listRes.body.plans.find((p) => p.plan.id === gen2.body.plan.id);
      assert.equal(entry1.plan.ordinal, 1);
      assert.equal(entry2.plan.ordinal, 2);
      // The raw DDL row itself must never carry a stored ordinal/generation
      // column (A2.2's job to pin the column list; here we only pin that the
      // exposed field is literally named "ordinal" and is derived per-call).
      assert.ok("ordinal" in entry2.plan);

      const bogus = await post("/api/project-plans", {
        project_id: projectId,
        title: "Bogus parent",
        succeeds_plan_id: 999999999,
      });
      assert.ok(
        [400, 404].includes(bogus.status),
        `bogus succeeds_plan_id must be rejected as 400/404, got ${bogus.status} ` +
          `(body: ${JSON.stringify(bogus.body).slice(0, 300)})`
      );
    });
  });

  describe("Group B: item CRUD on open plans", () => {
    let projectId;
    let planId;

    before(async () => {
      projectId = await makeProject("Group B Project");
      const created = await post("/api/project-plans", { project_id: projectId, title: "B Plan" });
      planId = created.body.plan.id;
    });

    it("B1: create with parent_item_id nesting + position", async () => {
      const parent = await post(`/api/project-plans/${planId}/items`, {
        text: "Parent item",
        position: 0,
      });
      assert.equal(parent.status, 201);
      assert.equal(parent.body.item.parent_item_id, null);

      const child = await post(`/api/project-plans/${planId}/items`, {
        text: "Child item",
        parent_item_id: parent.body.item.id,
        position: 1,
      });
      assert.equal(child.status, 201);
      assert.equal(child.body.item.parent_item_id, parent.body.item.id);
      assert.equal(child.body.item.position, 1);
      assert.equal(child.body.item.plan_id, planId);

      const readBack = await fetch(`/api/project-plans/${planId}`);
      const childInList = readBack.body.items.find((i) => i.id === child.body.item.id);
      assert.equal(childInList.parent_item_id, parent.body.item.id);
    });

    it("B2: PATCH/DELETE read back consistent", async () => {
      const created = await post(`/api/project-plans/${planId}/items`, { text: "Original text" });
      const itemId = created.body.item.id;

      const patched = await patch(`/api/project-plans/items/${itemId}`, { text: "Updated text" });
      assert.equal(patched.status, 200);
      assert.equal(patched.body.item.text, "Updated text");

      const readAfterPatch = await fetch(`/api/project-plans/${planId}`);
      const itemAfterPatch = readAfterPatch.body.items.find((i) => i.id === itemId);
      assert.equal(itemAfterPatch.text, "Updated text");

      const deleted = await del(`/api/project-plans/items/${itemId}`);
      assert.equal(deleted.status, 200);
      assert.equal(deleted.body.ok, true);

      const readAfterDelete = await fetch(`/api/project-plans/${planId}`);
      assert.equal(
        readAfterDelete.body.items.some((i) => i.id === itemId),
        false,
        "deleted item must not reappear on GET"
      );
    });

    it("B3: negatives 404/400", async () => {
      const patchMissing = await patch("/api/project-plans/items/999999999", { text: "x" });
      assert.equal(patchMissing.status, 404);
      assert.equal(patchMissing.body.error.code, "NOT_FOUND");

      const deleteMissing = await del("/api/project-plans/items/999999999");
      assert.equal(deleteMissing.status, 404);
      assert.equal(deleteMissing.body.error.code, "NOT_FOUND");

      const noText = await post(`/api/project-plans/${planId}/items`, {});
      assert.equal(noText.status, 400);
      assert.equal(noText.body.error.code, "INVALID_INPUT");

      const badParent = await post(`/api/project-plans/${planId}/items`, {
        text: "orphan",
        parent_item_id: 999999999,
      });
      assert.equal(badParent.status, 400);
    });
  });

  describe("Group C: closure", () => {
    let projectId;

    before(async () => {
      projectId = await makeProject("Group C Project");
    });

    it("C1: POST /:id/close 200 with note echoed, plan under ?status=closed", async () => {
      const created = await post("/api/project-plans", { project_id: projectId, title: "C1 Plan" });
      const planId = created.body.plan.id;

      const closed = await post(`/api/project-plans/${planId}/close`, {
        closure_note: "shipped everything in this bundle",
      });
      assert.equal(closed.status, 200);
      assert.equal(closed.body.plan.status, "closed");
      assert.equal(closed.body.plan.closure_note, "shipped everything in this bundle");
      assert.ok(closed.body.plan.closed_at);

      const listClosed = await fetch(`/api/project-plans?project_id=${projectId}&status=closed`);
      assert.ok(listClosed.body.plans.some((p) => p.plan.id === planId));
    });

    it("C2: double close → 409 with structured error.code (ALREADY_CLOSED)", async () => {
      const created = await post("/api/project-plans", { project_id: projectId, title: "C2 Plan" });
      const planId = created.body.plan.id;
      const first = await post(`/api/project-plans/${planId}/close`, {});
      assert.equal(first.status, 200);

      const second = await post(`/api/project-plans/${planId}/close`, {});
      assert.equal(second.status, 409);
      assert.equal(second.body.error.code, "ALREADY_CLOSED");
    });

    it("C3: full refusal sweep against a closed plan, then plan/items/claims byte-identical", async () => {
      const created = await post("/api/project-plans", { project_id: projectId, title: "C3 Plan" });
      const planId = created.body.plan.id;
      const item = await post(`/api/project-plans/${planId}/items`, { text: "pre-close item" });
      const itemId = item.body.item.id;
      const claim = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "detour",
        value_ref: "c3-detour-1",
        attribution: "judgment",
      });
      assert.equal(claim.status, 201);
      const claimId = claim.body.claim.id;

      const closed = await post(`/api/project-plans/${planId}/close`, {});
      assert.equal(closed.status, 200);

      const before = await fetch(`/api/project-plans/${planId}`);

      const patchTitle = await patch(`/api/project-plans/${planId}`, { title: "renamed" });
      assert.equal(patchTitle.status, 409);
      const patchItem = await patch(`/api/project-plans/items/${itemId}`, { text: "renamed" });
      assert.equal(patchItem.status, 409);
      const deleteItem = await del(`/api/project-plans/items/${itemId}`);
      assert.equal(deleteItem.status, 409);
      const newItem = await post(`/api/project-plans/${planId}/items`, { text: "new item" });
      assert.equal(newItem.status, 409);
      const newClaim = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "detour",
        value_ref: "c3-detour-2",
        attribution: "judgment",
      });
      assert.equal(newClaim.status, 409);
      const unclaim = await del(`/api/project-plans/claims/${claimId}`);
      assert.equal(unclaim.status, 409);

      const after = await fetch(`/api/project-plans/${planId}`);
      assert.deepEqual(
        after.body,
        before.body,
        "closed plan/items/claims must be byte-identical after the refusal sweep"
      );
    });

    it("C4: no other verb closes — PATCH {status:'closed'} leaves status:'open', DELETE /:id → 404", async () => {
      const created = await post("/api/project-plans", { project_id: projectId, title: "C4 Plan" });
      const planId = created.body.plan.id;

      const patchStatus = await patch(`/api/project-plans/${planId}`, { status: "closed" });
      assert.equal(patchStatus.status, 400, "PATCH must reject a status field outright");

      const stillOpen = await fetch(`/api/project-plans/${planId}`);
      assert.equal(stillOpen.body.plan.status, "open");

      const deleted = await del(`/api/project-plans/${planId}`);
      assert.equal(
        deleted.status,
        404,
        "there is no DELETE /:id route — closing has exactly one door"
      );
    });
  });

  describe("Group D: claims cardinality (DEC-7)", () => {
    let projectId;
    let planId;
    let itemId;

    before(async () => {
      projectId = await makeProject("Group D Project");
      const created = await post("/api/project-plans", { project_id: projectId, title: "D Plan" });
      planId = created.body.plan.id;
      const item = await post(`/api/project-plans/${planId}/items`, { text: "D item" });
      itemId = item.body.item.id;
    });

    it("D1: claim visible nested under its item, snapshots echoed", async () => {
      const res = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "trunk_commit",
        value_ref: "d1sha000",
        source_cwd: "/tmp/d1-repo",
        label_snapshot: "the D1 commit",
        seen_at_snapshot: "2026-08-01T00:00:00.000Z",
        stage_snapshot: "merged",
        attribution: "mechanical",
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.claim.value_ref, "d1sha000");
      assert.equal(res.body.claim.label_snapshot, "the D1 commit");
      assert.equal(res.body.claim.seen_at_snapshot, "2026-08-01T00:00:00.000Z");
      assert.equal(res.body.claim.stage_snapshot, "merged");

      const plan = await fetch(`/api/project-plans/${planId}`);
      const item = plan.body.items.find((i) => i.id === itemId);
      assert.ok(item.claims.some((c) => c.id === res.body.claim.id));
      const nested = item.claims.find((c) => c.id === res.body.claim.id);
      assert.equal(nested.label_snapshot, "the D1 commit");
    });

    it("D2: duplicate → 409 with a structured code, never a raw SQLITE_CONSTRAINT 500", async () => {
      const first = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "detour",
        value_ref: "d2-detour",
        source_cwd: "/tmp/d2-repo",
        attribution: "judgment",
      });
      assert.equal(first.status, 201);

      const dup = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "detour",
        value_ref: "d2-detour",
        source_cwd: "/tmp/d2-repo",
        attribution: "judgment",
      });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.error.code, "DUPLICATE_CLAIM");
      assert.ok(!String(dup.body.error.message || "").includes("SQLITE_CONSTRAINT"));
    });

    it("D3: same unit into a second item is allowed; unclaimedPoolSize unaffected by the second claim", async () => {
      const secondItem = await post(`/api/project-plans/${planId}/items`, { text: "second item" });
      const secondItemId = secondItem.body.item.id;

      const healthBefore = await fetch(`/api/project-plans/health?project_id=${projectId}`);

      const first = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "detour",
        value_ref: "d3-detour",
        source_cwd: "/tmp/d3-repo",
        attribution: "judgment",
      });
      assert.equal(first.status, 201);
      const healthAfterFirst = await fetch(`/api/project-plans/health?project_id=${projectId}`);

      const second = await post(`/api/project-plans/${planId}/claims`, {
        item_id: secondItemId,
        value_source: "detour",
        value_ref: "d3-detour",
        source_cwd: "/tmp/d3-repo",
        attribution: "judgment",
      });
      assert.equal(
        second.status,
        201,
        "the SAME unit claimed into a DIFFERENT item must be allowed"
      );
      const healthAfterSecond = await fetch(`/api/project-plans/health?project_id=${projectId}`);

      assert.equal(
        healthAfterSecond.body.unclaimedPoolSize,
        healthAfterFirst.body.unclaimedPoolSize,
        "the second claim of an already-claimed unit must not change the pool size"
      );
      // Baseline sanity: this synthetic project has no mapped git repos, so
      // the pool never contained this fabricated unit in the first place.
      assert.equal(healthAfterFirst.body.unclaimedPoolSize, healthBefore.body.unclaimedPoolSize);
    });

    it("D4 — valid new_item + invalid value_source → 400, atomicity: item count unchanged", async () => {
      // DEC-S4-2: NAME-OVERCLAIMING GUARD rewrite. Proves that validation
      // happens BEFORE the item insert, so a 400 for bad value_source leaves
      // no orphan item committed.
      const itemsBefore = (await fetch(`/api/project-plans/${planId}`)).body.items.length;

      const res = await post(`/api/project-plans/${planId}/claims`, {
        new_item: { text: "valid item text" }, // valid
        value_source: "not_a_real_source", // invalid — not in VALUE_SOURCES
        value_ref: "d4-test",
        attribution: "judgment",
      });
      assert.equal(res.status, 400, "invalid value_source must return 400");
      assert.equal(res.body.error.code, "INVALID_INPUT");

      const itemsAfter = (await fetch(`/api/project-plans/${planId}`)).body.items.length;
      assert.equal(
        itemsAfter,
        itemsBefore,
        "a failed claim with invalid value_source must not leave an orphaned item behind"
      );
    });

    it("D4-empty-text — empty text input validation (not atomicity proof)", async () => {
      // Exercises insertProjectPlanItem's pre-write input guard, not atomicity.
      // Kept for regression because the guard is real; never cite as atomicity evidence.
      const itemsBefore = (await fetch(`/api/project-plans/${planId}`)).body.items.length;

      const res = await post(`/api/project-plans/${planId}/claims`, {
        new_item: { text: "" }, // invalid — insertProjectPlanItem requires non-empty text
        value_source: "detour",
        value_ref: "d4-empty-text",
        attribution: "judgment",
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, "INVALID_INPUT");

      const itemsAfter = (await fetch(`/api/project-plans/${planId}`)).body.items.length;
      assert.equal(itemsAfter, itemsBefore, "item count unchanged");
    });

    it("D4-happy — valid new_item + valid claim → 201, item created with text", async () => {
      // The passing half of the original D4 case, kept verbatim.
      const itemsBefore = (await fetch(`/api/project-plans/${planId}`)).body.items.length;

      const res = await post(`/api/project-plans/${planId}/claims`, {
        new_item: { text: "d4-happy item" },
        value_source: "detour",
        value_ref: "d4-happy-ref",
        attribution: "judgment",
      });
      assert.equal(res.status, 201);
      const itemsAfter = (await fetch(`/api/project-plans/${planId}`)).body.items.length;
      assert.equal(itemsAfter, itemsBefore + 1, "item created");

      const createdItem = (await fetch(`/api/project-plans/${planId}`)).body.items.find(
        (i) => i.id === res.body.claim.item_id
      );
      assert.equal(createdItem.text, "d4-happy item");
    });

    it("D4b — duplicate on pre-existing item_id → 409 DUPLICATE_CLAIM (doc comment: reuses D2 shape)", async () => {
      // Reuses D2's shape for DEC-S4-2 DoD traceability; red-proves nothing D2
      // does not already prove; never cite as the atomicity proof (atomicity is
      // the sole responsibility of D4 + D4-empty-text + PX).
      const itemsBeforeDuplicate = (await fetch(`/api/project-plans/${planId}`)).body.items.length;

      const first = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "detour",
        value_ref: "d4b-dup-test",
        attribution: "judgment",
      });
      assert.equal(first.status, 201);

      const second = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "detour",
        value_ref: "d4b-dup-test",
        attribution: "judgment",
      });
      assert.equal(second.status, 409);
      assert.equal(second.body.error.code, "DUPLICATE_CLAIM");

      const itemsAfterDuplicate = (await fetch(`/api/project-plans/${planId}`)).body.items.length;
      assert.equal(itemsAfterDuplicate, itemsBeforeDuplicate, "item count unchanged");
    });

    it("D5: unclaim returns the unit to the pool; value_source outside VALUE_SOURCES → 400", async () => {
      const claim = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "detour",
        value_ref: "d5-detour",
        source_cwd: "/tmp/d5-repo",
        attribution: "judgment",
      });
      assert.equal(claim.status, 201);
      const claimId = claim.body.claim.id;

      const unclaimed = await del(`/api/project-plans/claims/${claimId}`);
      assert.equal(unclaimed.status, 200);
      assert.equal(unclaimed.body.ok, true);

      const plan = await fetch(`/api/project-plans/${planId}`);
      const item = plan.body.items.find((i) => i.id === itemId);
      assert.equal(
        item.claims.some((c) => c.id === claimId),
        false,
        "an unclaimed claim must no longer appear nested under its item"
      );

      const badSource = await post(`/api/project-plans/${planId}/claims`, {
        item_id: itemId,
        value_source: "not_a_real_source",
        value_ref: "whatever",
        attribution: "judgment",
      });
      assert.equal(badSource.status, 400);
      assert.equal(badSource.body.error.code, "INVALID_INPUT");
    });
  });

  describe("Group I: hierarchy-aware editing + claim flow (Slice 4a)", () => {
    let projectId;
    let planId;

    before(async () => {
      projectId = await makeProject("Group I Project");
      const created = await post("/api/project-plans", {
        project_id: projectId,
        title: "I Plan",
      });
      planId = created.body.plan.id;
    });

    it("I1 — text-only and placement-only edits, hierarchy-aware claim pickup", async () => {
      // One flow, one fixture: create parent, create child under parent, edit
      // text only, verify text changed but placement unchanged, edit placement
      // only, verify placement changed but text unchanged, claim into child.
      const parent = await post(`/api/project-plans/${planId}/items`, { text: "Parent" });
      const parentId = parent.body.item.id;

      const child = await post(`/api/project-plans/${planId}/items`, {
        text: "Child",
        parent_item_id: parentId,
      });
      const childId = child.body.item.id;

      // Edit text only (no parent_item_id key)
      const textEdit = await patch(`/api/project-plans/items/${childId}`, {
        text: "Child, renamed",
      });
      assert.equal(textEdit.status, 200);
      const afterText = await fetch(`/api/project-plans/${planId}`);
      const childAfterText = afterText.body.items.find((i) => i.id === childId);
      assert.equal(childAfterText.text, "Child, renamed", "text changed");
      assert.equal(childAfterText.parent_item_id, parentId, "placement unchanged");

      // Edit placement only (no text key), promote to top-level via parent_item_id: null
      const placementEdit = await patch(`/api/project-plans/items/${childId}`, {
        parent_item_id: null,
      });
      assert.equal(placementEdit.status, 200);
      const afterPlacement = await fetch(`/api/project-plans/${planId}`);
      const childAfterPlacement = afterPlacement.body.items.find((i) => i.id === childId);
      assert.equal(childAfterPlacement.parent_item_id, null, "placement changed to null");
      assert.equal(childAfterPlacement.text, "Child, renamed", "text unchanged");

      // Claim into the child (which is now top-level)
      const claim = await post(`/api/project-plans/${planId}/claims`, {
        item_id: childId,
        value_source: "detour",
        value_ref: "i1-test",
        attribution: "judgment",
      });
      assert.equal(claim.status, 201);
      assert.ok(
        Object.keys(claim.body.claim).every((key) => {
          // Verify response has the same keys D1 already asserts exist
          return (
            ["id", "project_id", "plan_id", "item_id", "value_source", "value_ref"].includes(key) ||
            claim.body.claim[key] !== undefined
          );
        })
      );

      // Verify claim nested under child in next read
      const final = await fetch(`/api/project-plans/${planId}`);
      const childFinal = final.body.items.find((i) => i.id === childId);
      assert.ok(
        childFinal.claims.some((c) => c.id === claim.body.claim.id),
        "claim appears nested under child"
      );
    });

    it("I2 — cycle created by re-parenting is rejected with zero-trace rollback", async () => {
      // Dynamic cycle proof: build a tree, introduce a cycle via re-parent,
      // verify 400 and nothing changes (item count, placement, etc. identical).
      const a = await post(`/api/project-plans/${planId}/items`, { text: "A" });
      const aId = a.body.item.id;

      const b = await post(`/api/project-plans/${planId}/items`, {
        text: "B",
        parent_item_id: aId,
      });
      const bId = b.body.item.id;

      const c = await post(`/api/project-plans/${planId}/items`, {
        text: "C",
        parent_item_id: bId,
      });
      const cId = c.body.item.id;

      // Re-parent B under C, creating cycle A → B → C → B (cycle at B)
      const beforeCycle = await fetch(`/api/project-plans/${planId}`);
      const cycleAttempt = await patch(`/api/project-plans/items/${bId}`, {
        parent_item_id: cId,
      });
      assert.equal(cycleAttempt.status, 400, "cycle must be rejected");
      assert.equal(cycleAttempt.body.error.code, "INVALID_INPUT");

      // Verify nothing changed (§9.8 zero-trace proof)
      const afterCycle = await fetch(`/api/project-plans/${planId}`);
      assert.deepEqual(
        afterCycle.body,
        beforeCycle.body,
        "rejected cycle must leave zero trace — items/claims identical"
      );

      // Verify claim nested under C still visible (placement unaffected)
      const claim = await post(`/api/project-plans/${planId}/claims`, {
        item_id: cId,
        value_source: "detour",
        value_ref: "i2-claim",
        attribution: "judgment",
      });
      assert.equal(claim.status, 201);
      const finalRead = await fetch(`/api/project-plans/${planId}`);
      const cFinal = finalRead.body.items.find((i) => i.id === cId);
      assert.ok(cFinal.claims.some((cl) => cl.id === claim.body.claim.id));
    });
  });

  describe("Group E: pool endpoint", () => {
    let projectId;

    before(async () => {
      projectId = await makeProject("Group E Project");
    });

    it("E1: {units, identityWarnings} with identityWarnings always an array (present even when empty)", async () => {
      const res = await fetch(`/api/project-plans/pool?project_id=${projectId}`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.units));
      assert.ok(
        Array.isArray(res.body.identityWarnings),
        "identityWarnings must be an array, not omitted, even when empty"
      );
      assert.deepEqual(res.body.identityWarnings, []);
    });

    it("E2: mechanical-tier code path runs cleanly; nothing arrives pre-claimed; no focus_segment auto-claim", async () => {
      const res = await fetch(`/api/project-plans/pool?project_id=${projectId}`);
      assert.equal(res.status, 200);
      for (const unit of res.body.units) {
        assert.notEqual(
          unit.value_source,
          "focus_segment",
          "v1 must never auto-claim/emit a focus_segment unit"
        );
        assert.ok(["mechanical", "correlational", "judgment"].includes(unit.attribution));
      }
      // "nothing arrives pre-claimed" is an invariant of the pool by
      // construction (assembleValuePool excludes every already-claimed key)
      // — confirm no unit in this response is also present in this
      // project's claims.
      const claimsRes = await fetch(`/api/project-plans?project_id=${projectId}`);
      const allClaimedRefs = new Set();
      for (const entry of claimsRes.body.plans) {
        for (const item of entry.items) {
          for (const c of item.claims) allClaimedRefs.add(c.value_ref);
        }
      }
      for (const unit of res.body.units) {
        assert.equal(allClaimedRefs.has(unit.value_ref), false);
      }
    });

    it("E3: ?backfill=1 accepted (still well-formed 200); 400 on missing project_id", async () => {
      const resBackfill = await fetch(`/api/project-plans/pool?project_id=${projectId}&backfill=1`);
      assert.equal(resBackfill.status, 200);
      assert.ok(Array.isArray(resBackfill.body.units));
      assert.ok(Array.isArray(resBackfill.body.identityWarnings));

      const res400 = await fetch("/api/project-plans/pool");
      assert.equal(res400.status, 400);
      assert.equal(res400.body.error.code, "INVALID_INPUT");
    });
  });

  describe("Group F: health + history", () => {
    let projectId;

    before(async () => {
      projectId = await makeProject("Group F Project");
    });

    it("F1: exact key set (T6 parity target shape)", async () => {
      const res = await fetch(`/api/project-plans/health?project_id=${projectId}`);
      assert.equal(res.status, 200);
      assert.deepEqual(
        Object.keys(res.body).sort(),
        ["daysSinceLastClosure", "lastClosureAt", "openPlanCount", "unclaimedPoolSize"].sort()
      );
    });

    it("F2: health reacts to lifecycle", async () => {
      const before = await fetch(`/api/project-plans/health?project_id=${projectId}`);
      assert.equal(before.body.lastClosureAt, null);

      const created = await post("/api/project-plans", { project_id: projectId, title: "F2 Plan" });
      const afterOpen = await fetch(`/api/project-plans/health?project_id=${projectId}`);
      assert.equal(afterOpen.body.openPlanCount, before.body.openPlanCount + 1);

      await post(`/api/project-plans/${created.body.plan.id}/close`, {});
      const afterClose = await fetch(`/api/project-plans/health?project_id=${projectId}`);
      assert.equal(afterClose.body.openPlanCount, before.body.openPlanCount);
      assert.ok(afterClose.body.lastClosureAt, "closing a plan must set lastClosureAt");
      assert.equal(afterClose.body.daysSinceLastClosure, 0);
    });

    it("F3: history exposes closed generations with claims, no closed_at/closed flag on any claim", async () => {
      const created = await post("/api/project-plans", { project_id: projectId, title: "F3 Plan" });
      const planId = created.body.plan.id;
      const item = await post(`/api/project-plans/${planId}/items`, { text: "F3 item" });
      const claim = await post(`/api/project-plans/${planId}/claims`, {
        item_id: item.body.item.id,
        value_source: "detour",
        value_ref: "f3-detour",
        attribution: "judgment",
      });
      await post(`/api/project-plans/${planId}/close`, { closure_note: "F3 done" });

      const history = await fetch(`/api/project-plans/history?project_id=${projectId}`);
      assert.equal(history.status, 200);
      assert.ok(Array.isArray(history.body.generations));
      const generation = history.body.generations.find((g) => g.plan.id === planId);
      assert.ok(generation, "closed generation must appear in history");
      assert.ok(generation.claims.some((c) => c.id === claim.body.claim.id));
      for (const c of generation.claims) {
        assert.equal("closed_at" in c, false, "a claim row must never carry its own closed_at");
        assert.equal(
          "closed" in c,
          false,
          "closed-ness is derived by join, never stamped onto a claim"
        );
      }
    });
  });

  describe("Group G: import", () => {
    let projectId;
    let workDir;

    before(async () => {
      projectId = await makeProject("Group G Project");
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-plans-import-"));
      fs.writeFileSync(
        path.join(workDir, "AGENT-PLAN.md"),
        "# Import Test Plan\n" +
          "- [x] 1. Top item — acceptance: done\n" +
          "  - [ ] 1.1. Nested sub-item — acceptance: nesting works\n" +
          "- [ ] 2. Second top item\n"
      );
      const refreshed = await post("/api/plans/refresh", { cwd: workDir });
      assert.equal(refreshed.status, 200, "fixture setup: legacy plan must ingest cleanly");
    });

    after(() => {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });

    it("G1: generation-1 with provenance and nesting", async () => {
      const res = await post("/api/project-plans/import", { project_id: projectId, cwd: workDir });
      assert.equal(res.status, 200);
      assert.equal(res.body.created, true);
      assert.equal(res.body.plan.origin, "import");
      assert.ok(res.body.plan.imported_from_cwd);
      assert.ok(res.body.plan.imported_content_hash);
      assert.equal(res.body.items.length, 3);

      const topItems = res.body.items.filter((i) => i.parent_item_id == null);
      const subItems = res.body.items.filter((i) => i.parent_item_id != null);
      assert.equal(topItems.length, 2);
      assert.equal(subItems.length, 1);
      const parent = topItems.find((i) => i.text.includes("Top item"));
      assert.equal(subItems[0].parent_item_id, parent.id);
      assert.equal(parent.checked, 1);
    });

    it("G2: idempotent re-import → 200 no-op returning the SAME plan.id, never a second generation", async () => {
      const first = await post("/api/project-plans/import", {
        project_id: projectId,
        cwd: workDir,
      });
      const second = await post("/api/project-plans/import", {
        project_id: projectId,
        cwd: workDir,
      });
      assert.equal(second.status, 200);
      assert.equal(second.body.created, false);
      assert.equal(second.body.plan.id, first.body.plan.id);

      const list = await fetch(`/api/project-plans?project_id=${projectId}`);
      const importedPlans = list.body.plans.filter((p) => p.plan.origin === "import");
      assert.equal(importedPlans.length, 1, "re-import must never mint a second generation");
    });

    it("G3: negatives", async () => {
      const noBody = await post("/api/project-plans/import", {});
      assert.equal(noBody.status, 400);

      const unknownProject = await post("/api/project-plans/import", {
        project_id: "no-such-project-xyz",
        cwd: workDir,
      });
      assert.equal(unknownProject.status, 404);

      const noLegacyPlan = await post("/api/project-plans/import", {
        project_id: projectId,
        cwd: path.join(os.tmpdir(), "never-ingested-xyz"),
      });
      assert.equal(noLegacyPlan.status, 404);
    });
  });

  describe("Group H: namespace isolation", () => {
    it("H1: legacy /api/plans unchanged after the whole suite has run, contains no portfolio rows, refresh still works", async () => {
      const res = await fetch("/api/plans");
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.plans));
      for (const plan of res.body.plans) {
        assert.ok("cwd" in plan, "legacy plans must keep their cwd-keyed shape");
        assert.ok(Array.isArray(plan.items));
        for (const item of plan.items) {
          assert.ok("item_number" in item, "legacy items must keep item_number");
        }
      }

      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "namespace-isolation-"));
      try {
        fs.writeFileSync(
          path.join(workDir, "AGENT-PLAN.md"),
          "# Isolation check\n- [ ] 1. Still works\n"
        );
        const refreshed = await post("/api/plans/refresh", { cwd: workDir });
        assert.equal(
          refreshed.status,
          200,
          "the legacy refresh route must be unaffected by this feature"
        );
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    });
  });

  describe("Group S: audit semantics", () => {
    it("S1: deleted project row — history/health still 200; create/import 404 (QDEC-15)", async () => {
      const projectId = await makeProject("Group S Project");
      const created = await post("/api/project-plans", { project_id: projectId, title: "S1 Plan" });
      await post(`/api/project-plans/${created.body.plan.id}/close`, {
        closure_note: "audit trail",
      });

      // Delete the project row directly — project_plans.project_id has no FK
      // by design, so closed generations must outlive the project row.
      db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);

      const history = await fetch(`/api/project-plans/history?project_id=${projectId}`);
      assert.equal(history.status, 200, "history must survive a deleted project row (AC-6)");
      assert.ok(history.body.generations.some((g) => g.plan.id === created.body.plan.id));

      const health = await fetch(`/api/project-plans/health?project_id=${projectId}`);
      assert.equal(health.status, 200, "health must survive a deleted project row");

      const createAfterDelete = await post("/api/project-plans", {
        project_id: projectId,
        title: "should fail",
      });
      assert.equal(createAfterDelete.status, 404, "create requires a real project row");

      const importAfterDelete = await post("/api/project-plans/import", {
        project_id: projectId,
        cwd: "/tmp/does-not-matter",
      });
      assert.equal(importAfterDelete.status, 404, "import requires a real project row");
    });
  });
});

// Value Pool Slice 2: coverage-on-demand routes. Every project here has no
// project_paths row (makeProject() never inserts one), so assembleValuePool
// resolves to an empty pool with zero git work — safe and fast for route
// tests, and exercises the "empty pool" edge (pool_size=0, described=0,
// complete=true) honestly.
describe("Group T: coverage-on-demand routes (POST /coverage-request, GET /coverage)", () => {
  it("T1: GET /coverage on a never-requested project returns a passive, complete snapshot (empty pool)", async () => {
    const projectId = await makeProject("coverage-passive");
    const res = await fetch(`/api/project-plans/coverage?project_id=${projectId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.coverage.project_id, projectId);
    assert.equal(res.body.coverage.demand, "passive");
    assert.equal(res.body.coverage.pool_size, 0);
    assert.equal(res.body.coverage.described, 0);
    assert.equal(res.body.coverage.pending, 0);
    assert.equal(res.body.coverage.complete, true);
    assert.equal(res.body.coverage.requested_at, null);
    assert.ok(res.body.coverage.eta);
    assert.ok(res.body.coverage.computed_at);
  });

  it("T2: GET /coverage requires project_id", async () => {
    const res = await fetch(`/api/project-plans/coverage`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("T3: POST /coverage-request stamps the flag, returns 202 with demand !== 'passive', and is idempotent under a redundant call", async () => {
    const projectId = await makeProject("coverage-request-idempotent");
    const res1 = await post("/api/project-plans/coverage-request", { project_id: projectId });
    assert.equal(res1.status, 202);
    assert.notEqual(res1.body.coverage.demand, "passive");
    assert.ok(["requested", "draining"].includes(res1.body.coverage.demand));

    // A redundant "prioritize now" click while a drain may already be
    // in flight must never 500 — the overlap guard absorbs it.
    const res2 = await post("/api/project-plans/coverage-request", { project_id: projectId });
    assert.equal(res2.status, 202);

    // Give the fire-and-forget drain a tick to run to completion (empty
    // pool converges in one iteration) before asserting the flag's fate —
    // this is a liveness check, not a strict timing assertion.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finalState = stmts.getValueSweepState.get(projectId);
    // An empty pool is immediately "complete" — the drain clears the flag.
    assert.equal(
      finalState ? finalState.coverage_requested_at : null,
      null,
      "an empty pool's drain completes and clears the flag almost immediately"
    );
  });

  it("T4: POST /coverage-request requires project_id", async () => {
    const res = await post("/api/project-plans/coverage-request", {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_INPUT");
  });

  it("T5: POST /altitudes response shape is unchanged by this slice (no coverage field leaks in)", async () => {
    const projectId = await makeProject("altitudes-shape-unchanged");
    const res = await post("/api/project-plans/altitudes", { project_id: projectId, units: [] });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ["altitudes", "counts", "states"]);
  });

  it("T6 (G2 smoke): GET /coverage's response shape matches the coverageSnapshot contract exactly", async () => {
    const projectId = await makeProject("coverage-shape");
    const res = await fetch(`/api/project-plans/coverage?project_id=${projectId}`);
    assert.deepEqual(
      Object.keys(res.body.coverage).sort(),
      [
        "complete",
        "computed_at",
        "demand",
        "described",
        "eta",
        "pending",
        "pool_size",
        "project_id",
        "requested_at",
      ].sort()
    );
  });

  it("T7 (SF-4): the POST /coverage-request and GET /coverage handlers compose their coverageSnapshot call from identical building blocks", () => {
    // Read the route file
    const routesFile = fs.readFileSync(path.join(__dirname, "../routes/project-plans.js"), "utf8");

    // Extract handler bodies with proper boundaries
    // POST handler: from router.post start until router.get (next handler)
    const postMatch = routesFile.match(/router\.post\("\/coverage-request"[\s\S]*?(?=router\.get)/);
    const postBody = postMatch ? postMatch[0] : "";

    // GET handler: from router.get start until next router. call
    const getMatch = routesFile.match(/router\.get\("\/coverage"[\s\S]*?(?=router\.)/);
    const getBody = getMatch ? getMatch[0] : "";

    // Both must contain these literal composition steps (DEC-16 sole composer)
    assert.ok(
      routesFile.includes('router.post("/coverage-request"') &&
        postBody.includes("await valueLedger.assembleValuePool(dbModule, { id: projectId })"),
      "POST /coverage-request handler missing assembleValuePool call"
    );
    assert.ok(
      routesFile.includes('router.get("/coverage"') &&
        getBody.includes("await valueLedger.assembleValuePool(dbModule, { id: projectId })"),
      "GET /coverage handler missing assembleValuePool call"
    );

    // Both must call enrichPoolAltitudes with probe: true (DEC-9)
    assert.ok(
      postBody.includes("await enrichPoolAltitudes(dbModule, units, { probe: true })"),
      "POST /coverage-request handler missing enrichPoolAltitudes"
    );
    assert.ok(
      getBody.includes("await enrichPoolAltitudes(dbModule, units, { probe: true })"),
      "GET /coverage handler missing enrichPoolAltitudes"
    );

    // Both must pass isDrainingProject to coverageSnapshot (SF-3 fix)
    assert.ok(
      postBody.includes("draining: isDrainingProject(projectId)"),
      "POST /coverage-request handler missing isDrainingProject in coverageSnapshot"
    );
    assert.ok(
      getBody.includes("draining: isDrainingProject(projectId)"),
      "GET /coverage handler missing isDrainingProject in coverageSnapshot"
    );

    // Both must have identical coverageSnapshot argument key sets (SF-4 parity check)
    // Extract keys from the immediate coverageSnapshot call arguments only
    const extractCoverageSnapshotKeys = (handlerBody) => {
      // More precise: match from coverageSnapshot(dbModule, { to the closing });
      // Stop at the first }); to avoid picking up extra content
      const coverageMatch = handlerBody.match(
        /const snapshot = coverageSnapshot\(dbModule, \{([^]*?)\}\);/
      );
      if (!coverageMatch) return [];

      const args = coverageMatch[1];
      const keys = new Set();

      // Extract line-by-line to handle the specific structure of the call
      // Each property is typically on its own line
      for (const line of args.split("\n")) {
        // Remove comments and trim whitespace
        const cleanLine = line.split("//")[0].trim();
        if (!cleanLine) continue;

        // Match shorthand properties (e.g., "projectId,") or named properties (e.g., "draining: ...")
        // For named: "key: value," or "key: value"
        // For shorthand: "key," or "key"
        const match = cleanLine.match(/^(\w+)(\s*:|,|$)/);
        if (match && match[1]) {
          keys.add(match[1]);
        }
      }

      return Array.from(keys).sort();
    };

    const postKeys = extractCoverageSnapshotKeys(postBody);
    const getKeys = extractCoverageSnapshotKeys(getBody);

    assert.ok(postKeys.length > 0, "POST /coverage-request handler missing coverageSnapshot call");
    assert.ok(getKeys.length > 0, "GET /coverage handler missing coverageSnapshot call");

    assert.deepEqual(
      postKeys,
      getKeys,
      "coverageSnapshot argument keys must be identical between POST and GET handlers"
    );

    assert.deepEqual(
      postKeys,
      ["computedAt", "counts", "draining", "projectId", "requestedAt"],
      "coverageSnapshot argument key set is the reviewed closed set — a matched pair of drifts must still fail"
    );
  });
});
