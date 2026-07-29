# E2E / Integration Test Design — WIP Queue Page

> Scope: the flows the unit layer can't prove on its own — the live
> WebSocket wiring, the new API's full contract (request → persisted DB
> state → broadcast reaching a real connected client), the sidecar
> drag-and-drop persistence round-trip, and the container-driven (not
> viewport-driven) responsive column-fill. Exhaustive sort/column-fill/
> validation *permutations* are the unit layer's job
> (`wipQueue.test.ts`, `projectLookup.test.ts`, `sessionSurfaceParity.test.ts`,
> server `projects.test.js` validation cases) — this document does not
> re-litigate those.

## 0. Grounding: this repo has no browser e2e tool

Confirmed by direct inspection: no Playwright/Cypress config exists anywhere
in the repo (`find . -iname "playwright*" -o -iname "cypress*"` → nothing),
no `PROJECT-CONTEXT.md` exists, and there is no smoke/regression *tag*
convention (no `@smoke`/`@regression` grep-tags, no serial/parallel test
"projects"). What this repo actually has, and what "e2e" means here:

- **Server integration layer**: `node --test server/__tests__/*.test.js`
  (`npm run test:server`). Each spec file boots a **real** `http.Server` +
  **real** Express app + **real** SQLite file via `createApp()`/
  `startServer(app, 0)` (see `server/__tests__/projects.test.js`,
  `monitors.test.js`, `api.test.js`) and drives it over real HTTP with a
  small `fetch`/`fetchJson` helper. This is this project's "API/contract
  bucket." No existing server test opens a real WebSocket client to assert
  a broadcast reaches a connected socket — that's new coverage this
  feature needs (see §2).
- **Client wiring layer**: Vitest + Testing Library (`npm run test:client`).
  Pages are mounted with a **mocked** `api` module (`vi.mock("../../lib/api")`)
  but, critically, live-update proof comes from the **real, un-mocked**
  `eventBus` singleton — `client/src/components/__tests__/SessionCard.focus.test.tsx`
  and `client/src/components/Tabby/__tests__/Tabby.test.tsx` both import
  the real `eventBus` and call `eventBus.publish({ type, data, timestamp })`
  directly to simulate an inbound WS message, then assert the mounted
  component's DOM updates. **This is the pattern to reuse for WIP's live
  lifecycle test, not the no-op `eventBus` mock in
  `screens.snapshot.test.tsx`/`KanbanBoard.projectsView.test.tsx`** (that
  mock's `subscribe: () => () => {}` never invokes a handler — it exists
  only so pages mount without a live socket, and cannot drive a
  publish-then-assert lifecycle test). Flagging this because both
  `technical-plan.md` §6 and `supporting/qa.md` §3.4 cite the no-op-mock
  files as "the pattern to reuse" for WIP.test.tsx's live-update cases,
  which doesn't actually work for that purpose — worth a one-line
  correction when the spec is built.
- **No real browser layout**: jsdom has no box-layout engine and no
  `ResizeObserver` implementation (`Sidebar.tsx` guards with
  `typeof ResizeObserver !== "undefined"` for exactly this reason). §4
  below designs what *can* be proven this way (wiring) versus what
  genuinely can't (real pixel breakpoints) — `supporting/qa.md` §3.2
  independently flags the same gap ("if breakpoints are CSS media
  queries... can only be verified via a browser/e2e-level check").

---

## 1. Flows to cover

1. **Live queue membership + live reordering** — a session transitioning to
   `active` appears in the WIP queue without a reload; a session that
   receives `awaiting_input_since` moves to the top of its priority tier
   live; a session leaving `active` status via a `session_updated`
   status-flip is removed immediately; a session removed via a distinct
   `session_deleted` event is also removed immediately (two independent
   code paths per the plan's Engineer's gotcha #2 — one must not be assumed
   to cover the other).
2. **`PUT /api/projects/reorder` full contract** — send `{ order: string[] }`,
   confirm the dense-rank `priority` values are actually persisted (a
   follow-up `GET /api/projects` reflects them, not just the PUT response),
   and confirm the `project_updated` broadcast (`{ projects: [{ id,
   priority }] }`) actually reaches a second, independently connected
   WebSocket client — not just that `broadcast()` was called.
3. **Sidecar drag-and-drop persists priority, and it survives a reload** —
   dragging a project to a new position in the sidecar commits via
   `api.projects.reorder`, and re-fetching (simulating a reload) reflects
   the new order, not the pre-drag one.
4. **Container-driven (not viewport-driven) responsive column-fill** —
   1/2/3-column layout responds to the *queue container's own* measured
   width; specifically, the architect's highest-risk case: opening/resizing
   the sidecar shrinks the queue container without changing
   `window.innerWidth`, and the column count must still drop.

---

## 2. Spec files to add/update

### 2a. `server/__tests__/projects.test.js` — extend (existing file)

This is the project's existing "Project CRUD" API/contract bucket
(`node --test`, real HTTP server, real SQLite). Add:

```js
describe("PUT /api/projects/reorder", () => {
  // ...existing-shape validation cases (400 non-array, 400 duplicate id,
  // 404 unknown id, 400 empty array) modeled on monitors.test.js's
  // GET-default/PUT-full/PUT-rejects shape...

  it("persists dense ranks matching array order, a follow-up GET reflects them, "
   + "and a connected WS client receives project_updated", async () => {
    const a = (await post("/api/projects", { name: "A" })).body.project;
    const b = (await post("/api/projects", { name: "B" })).body.project;

    const WebSocket = require("ws");
    const wsClient = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws`);
    await new Promise((resolve) => wsClient.once("open", resolve));
    const nextMessage = () =>
      new Promise((resolve) => wsClient.once("message", (raw) => resolve(JSON.parse(raw))));

    const res = await put("/api/projects/reorder", { order: [b.id, a.id] });
    assert.equal(res.status, 200);

    const msg = await nextMessage();
    assert.equal(msg.type, "project_updated");
    assert.deepEqual(
      [...msg.data.projects].sort((x, y) => x.id.localeCompare(y.id)),
      [{ id: a.id, priority: 1 }, { id: b.id, priority: 0 }].sort((x, y) =>
        x.id.localeCompare(y.id)
      )
    );

    // DB round-trip, not just the PUT response echo.
    const list = (await get("/api/projects")).body.projects;
    assert.equal(list.find((p) => p.id === b.id).priority, 0);
    assert.equal(list.find((p) => p.id === a.id).priority, 1);

    wsClient.close();
  });

  it("does not broadcast project_updated for a plain rename (scope carve-out)", async () => {
    const p = (await post("/api/projects", { name: "C" })).body.project;
    // attach a WS client, PATCH the name, assert no message arrives within
    // a short window — confirms the documented "priority only" carve-out
    // hasn't silently widened to general project CRUD.
  });
});
```

`ws` is already a runtime dependency (`server/websocket.js` uses it), so
this needs no new package. `isWebSocketAuthorized`/`isHostAllowed` both
pass trivially for a loopback test client with no `DASHBOARD_TOKEN` set, so
no auth setup is needed beyond what `startServer` already does.

**Why here, not a new file**: `projects.test.js` already owns the
project-CRUD contract and its own `before`/`after` server lifecycle;
reorder is one more route on the same router. A real-WS-client assertion
is new *technique* in this file (no existing server test opens a `ws`
client), but it belongs with the endpoint it's proving, not off in a
separate WebSocket-only file — there's no precedent in this repo for
splitting one route's contract test across files.

### 2b. `client/src/pages/__tests__/WIP.test.tsx` — new

Mount the real `WIP` page with a **mocked `api`** module (sessions/projects
list + `api.projects.reorder`) but the **real, un-mocked `eventBus`**
(per §0 — this is the one correction to make relative to
`technical-plan.md`/`qa.md`'s cited pattern). Drives flows 1 and 3; the
wiring half of flow 4 (see §2c).

```ts
// no vi.mock("../../lib/eventBus") — use the real singleton, exactly as
// SessionCard.focus.test.tsx and Tabby.test.tsx do.
import { eventBus } from "../../lib/eventBus";
...
eventBus.publish({ type: "session_updated", data: { ...session, status: "completed" }, timestamp });
```

Cases (mirrors `technical-plan.md` §6 client item 4 / `qa.md` §3.4, but
using the real-eventBus mechanism):
- `session_created` (active, non-awaiting) → new card appears in the
  correctly-sorted position.
- `session_updated` setting `awaiting_input_since` on an existing,
  previously-non-waiting card → it live-reorders to the top of its
  priority tier, with no `api.sessions.list`/`api.projects.list` re-fetch
  (assert the mocked list functions' call counts don't increase).
- `session_updated` flipping `status` off `"active"` → card is removed
  immediately, no re-fetch.
- `session_deleted` → card is removed immediately — asserted as a
  **separate** test case from the status-flip removal, per the plan's
  explicit two-removal-paths requirement.
- `project_updated` with a new priority order (no session event involved)
  → the main queue's tiebreak order changes live.
- Sidecar drag commits: `fireEvent.dragStart`/`dragOver`/`dragEnd` on the
  sidecar's project rows (same event sequence
  `KanbanBoard.projectsView.test.tsx` already uses for its monitor-box
  drag, e.g. lines ~297–299 and ~679–681 — no `dataTransfer` mock needed,
  this codebase's hand-rolled DnD only wires `onDragStart`/`onDragOver`/
  `onDragEnd`) → `api.projects.reorder` is called with the expected
  `order: string[]`.
- **Reload round-trip**: after the drag commits, unmount and re-render the
  page against a mocked `api.projects.list`/`api.sessions.list` that now
  returns the *post-drag* priority values (simulating what a real reload
  would fetch) → the queue renders in the new order, proving persistence
  isn't just an optimistic local-state illusion.

### 2c. `client/src/pages/__tests__/WIP.test.tsx` (same file) — column-fill wiring

Structural proof only (exhaustive width→columnCount mapping and fill-order
math belongs to the unit layer's `wipQueue.test.ts`/`assignToColumns`
tests, not here):

```ts
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.callback = cb; FakeResizeObserver.instances.push(this); }
  observe(target: Element) { this.target = target; }
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

function fireWidth(width: number) {
  const [ro] = FakeResizeObserver.instances;
  ro.callback([{ target: ro.target, contentRect: { width } } as ResizeObserverEntry], ro as any);
}
```

- Mount, then `fireWidth(1200)` → 3 columns render.
- `fireWidth(900)` (still on the *same* observer instance, i.e. the queue
  container, not `window`) → drops to 2 columns, **with
  `window.innerWidth` left untouched** — this is the direct proof for the
  architect's highest-risk case (sidecar shrinking the container
  independent of viewport). Explicitly also assert that firing a bare
  `window.dispatchEvent(new Event("resize"))` with no `ResizeObserver`
  callback invocation does **not** change the column count — confirms the
  page is driven by the container `ResizeObserver`, not a viewport
  listener, which is the exact regression this test exists to catch if
  someone "simplifies" it to `window.innerWidth` later.
- `fireWidth(500)` → 1 column.

**What this does not prove** (left to manual verification, §5): that the
real sidecar, when opened in an actual browser, actually shrinks the real
queue container by a real number of real pixels crossing a real 768/1024
threshold, or that the CSS actually renders 1/2/3 real columns. jsdom has
no layout engine to verify that; this repo has no Playwright/Cypress to
add real-browser coverage without a separate infrastructure decision.

### 2d. `client/src/pages/__tests__/screens.snapshot.test.tsx` — extend (existing file)

Add the `"WIP"` case following the file's own documented precedent for how
`FocusCalendarBoard` was added (mocked API, no-op `eventBus`, empty
fixtures). Not a lifecycle test — a render-doesn't-crash + nav-present
regression guard. Run the full suite before *and* after the `Sidebar.tsx`
nav-entry change and review (don't blindly `-u`) any diff in other
screens' snapshots that render sidebar chrome.

---

## 3. Bucket / tag

This repo has no smoke/regression tag system (no Playwright `--grep`
projects, no `PROJECT-CONTEXT.md`-declared bucket scheme). The real,
discovered convention is simpler and file-scoped:

- **Bucket = which npm script + which spec file.** Server contract/broadcast
  coverage lives in `server/__tests__/projects.test.js`, runs under
  `npm run test:server`. Client lifecycle/wiring coverage lives in
  `client/src/pages/__tests__/WIP.test.tsx`, runs under `npm run test:client`.
- **No serial requirement.** Each server spec file gets its own ephemeral
  SQLite file (`path.join(os.tmpdir(), \`dashboard-<name>-test-${Date.now()}-${process.pid}.db\`)`)
  — that's this project's existing mechanism for safe file-level
  parallelism, not a tag. Nothing in this feature's tests needs to opt out
  of it: the new `projects.test.js` reorder cases share the file's
  existing single `before`/`after` server instance (fine — reorder is
  additive route coverage on the same app), and `WIP.test.tsx` is a fresh
  jsdom module per Vitest's own file isolation.
- Both new/extended files must be included, unmodified-passing, in the
  standard "before finishing" run this project's `CLAUDE.md` already
  requires: `npm run test:server` and `npm run test:client`.

---

## 4. Assertions (concrete, per flow)

**Flow 1 — live lifecycle**
- A `session_created`/`session_updated`(→active) event for a session whose
  `cwd` maps to a known project renders a `WipSessionCard` for that
  session, reusing the *existing* `SessionCard` DOM contract (assert via
  the session's name/status text, same query style
  `KanbanBoard.projectsView.test.tsx` uses).
- `awaiting_input_since` being set moves that card above every non-awaiting
  card in the same render pass — no full-list re-fetch (mock call-count
  assertion).
- Both removal paths (`session_updated` status flip, `session_deleted`)
  each independently remove the card with no re-fetch — two separate test
  cases, not one asserting both.
- A session whose status is never `active` (or that flips to a terminal
  state) never appears / disappears — no dangling stale card.

**Flow 2 — reorder contract**
- Request shape: `{ order: string[] }`; malformed input → structured
  `400` (`INVALID_INPUT`-style code, matching this file's existing error
  shape); an id not in `stmts.getProject` → `404 NOT_FOUND` naming the
  missing id; duplicate ids → `400`.
- Persisted DB state: dense ranks `0..N-1` matching array order, verified
  via a **follow-up `GET /api/projects`**, not just trusting the PUT
  response echo.
- Broadcast reaches a connected client: a real `ws` client attached to the
  same server receives exactly one `project_updated` message shaped
  `{ projects: [{ id, priority }] }` — no extra fields, no other project
  mutation (rename/path add/remove/delete) ever emits this message type
  (the documented carve-out).

**Flow 3 — sidecar DnD + reload**
- The DnD gesture (`dragStart`→`dragOver`→`dragEnd`) on the sidecar's
  project rows calls `api.projects.reorder` with the id array in the new
  top-to-bottom order.
- After a simulated reload (unmount/remount against updated mocked list
  data), the sidecar's own display order *and* the main queue's tiebreak
  order both reflect the persisted order — not the pre-drag one, and not
  an optimistic-only local state that a real reload would have discarded.

**Flow 4 — column-fill wiring**
- Column count follows the queue container's measured width via
  `ResizeObserver`, not `window.innerWidth` — proven by firing the fake
  observer's callback with a new width while leaving `window.innerWidth`
  untouched, and by proving a bare `window resize` event with no observer
  callback does nothing.
- No unresolved placeholder / undefined column ever renders (e.g. a
  `columnCount` of `NaN`/`0` from a zero-width container edge case) reaches
  the DOM — assert exactly 1/2/3 column containers exist for each fired
  width, never zero or an unexpected count.

---

## 5. How to run a single spec

- Server: `node --test server/__tests__/projects.test.js`
  (per `supporting/qa.md`'s own documented convention). No dev server or
  external stack needed — the spec boots its own ephemeral HTTP server +
  SQLite file in `before`/`after`.
- Client: `cd client && npx vitest run src/pages/__tests__/WIP.test.tsx`
  (same convention, documented in `supporting/qa.md` §1). No dev server
  needed — `api` is mocked, `eventBus` is real-but-in-process (no actual
  socket), jsdom provides the DOM.
- Snapshot case only:
  `cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx`;
  regenerate baselines only after reviewing the diff:
  `cd client && npx vitest run -u`.

No environment variables or running integration stack are required for
any of the above — unlike a browser e2e suite, everything here is either
an in-process HTTP server the test itself starts, or jsdom.

---

## 6. Cost note — minimum set, and what's deliberately NOT here

This layer is intentionally thin. Kept to exactly what proves the wiring
across process/layer boundaries that a pure-function unit test can't see:

- **One** server test proving the full reorder contract + one real-socket
  broadcast assertion + one carve-out-scope negative case (not every
  validation permutation — that's `server/__tests__/projects.test.js`'s
  existing per-field validation style, extended minimally).
- **One** client spec (`WIP.test.tsx`) covering both removal paths, one
  addition, one live-reorder-via-awaiting-input, one live-reorder-via-
  `project_updated`, one DnD-commit, one reload-round-trip, and the
  column-fill wiring probes — not every sort-tiebreak or column-remainder
  permutation, which is `wipQueue.test.ts`'s job (already scoped in
  `technical-plan.md` §6/§8 as a separate unit spec).

**Explicitly NOT covered at this layer** (left to the unit layer or to
manual verification, and why):
- Exhaustive `sortWipQueue` tiebreak permutations (priority direction,
  most-recent-activity tertiary order, the `isPrimaryAwaitingReason`
  carve-out) — `client/src/lib/__tests__/wipQueue.test.ts`'s job; it's pure
  logic with no DOM/WS dependency, cheaper and more exhaustive there.
- Exhaustive `assignToColumns` fill-math (uneven remainders, 0/1-item
  edges, exact per-column counts) — same file, same reasoning; this
  document's column-fill cases only prove the *wiring* (container width →
  re-render), not the arithmetic.
- Exhaustive request-validation permutations for
  `PUT /api/projects/reorder` (every malformed-body shape) —
  `server/__tests__/projects.test.js`'s existing per-case style already
  covers this shape for `monitors.test.js`'s sibling endpoint; reuse that
  density, don't duplicate it here.
- **Real-browser pixel/layout proof of the 768/1024 breakpoints and the
  sidecar's actual geometry** — cannot be produced by this repo's tooling
  (jsdom has no layout engine or real `ResizeObserver`; no Playwright/
  Cypress is installed). This is the one gap in this document's coverage
  for flow 4 that is a genuine tooling gap, not a scoping choice. The only
  current mitigation is the manual verification step already specified in
  `technical-plan.md` §6 ("resize-with-sidecar-open... the one place a
  viewport-only trigger would have silently misbehaved") — flagging this
  explicitly rather than silently treating the jsdom wiring test in §2c as
  full proof of the real-browser behavior.
- `sessionSurfaceParity.test.ts` (cross-consumer drift guard) and the
  `KanbanBoard.tsx` refactor regression re-run
  (`KanbanBoard.projectsView.test.tsx`, `SessionCard.test.tsx`,
  `SessionCard.focus.test.tsx`) are unit/regression-layer concerns already
  scoped elsewhere in this intake — not duplicated here.
