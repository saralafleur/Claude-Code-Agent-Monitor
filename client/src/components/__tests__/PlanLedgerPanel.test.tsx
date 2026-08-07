/**
 * @file Tests for PlanLedgerPanel: the two-pane UI for managing project plans
 * and value claims (left: open plans with nested items and close action;
 * right: pool with tier badges and claim gesture; collapsed closed history).
 * Left pane renders 2 open plans with nested items (child nesting proven via
 * within); pool units render tier badges derived from ValueUnit type union;
 * claim gesture calls api.projectPlans.claim once and unit disappears; close
 * calls api.projectPlans.close and plan moves to collapsed closed list; health
 * numbers render verbatim from server (mocked health.unclaimedPoolSize=37 while
 * pool array length=5 → shows 37, proving no client-side re-derivation §9.1);
 * lastClosureAt:null renders without NaN/Invalid Date; closed generation hides
 * item/claim/unclaim affordances; no raw projectDetail.* key leaks into DOM;
 * PROJECT/STAKEHOLDER altitudes show a "generating" placeholder before
 * api.projectPlans.altitudes resolves, then the resolved text, called exactly
 * once per unit batch (never re-requested on an unrelated re-render).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PlanLedgerPanel } from "../PlanLedgerPanel";

const mockClaimMock = vi.fn();
const mockCloseMock = vi.fn();
const mockListMock = vi.fn();
const mockPoolMock = vi.fn();
const mockHealthMock = vi.fn();
const mockRefreshMock = vi.fn();
const mockAltitudesMock = vi.fn();
const mockMarkSeenMock = vi.fn();
const mockCoverageMock = vi.fn();
const mockRequestCoverageMock = vi.fn();
const mockAddItemMock = vi.fn();
const mockUpdateItemMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    projectPlans: {
      list: (...args: unknown[]) => mockListMock(...args),
      pool: (...args: unknown[]) => mockPoolMock(...args),
      health: (...args: unknown[]) => mockHealthMock(...args),
      claim: (...args: unknown[]) => mockClaimMock(...args),
      close: (...args: unknown[]) => mockCloseMock(...args),
      refresh: (...args: unknown[]) => mockRefreshMock(...args),
      altitudes: (...args: unknown[]) => mockAltitudesMock(...args),
      markAltitudesSeen: (...args: unknown[]) => mockMarkSeenMock(...args),
      coverage: (...args: unknown[]) => mockCoverageMock(...args),
      requestCoverage: (...args: unknown[]) => mockRequestCoverageMock(...args),
      addItem: (...args: unknown[]) => mockAddItemMock(...args),
      updateItem: (...args: unknown[]) => mockUpdateItemMock(...args),
    },
  },
}));

// Mock data factories for ProjectPlan and related types
function makePlan(overrides: any = {}) {
  return {
    plan: {
      id: 1,
      project_id: "proj-1",
      title: "Phase 1: Intake",
      status: "open",
      origin: "manual",
      ordinal: 1,
      opened_at: "2026-06-01T00:00:00.000Z",
      closed_at: null,
      closure_note: null,
      succeeds_plan_id: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      ...overrides,
    },
    items: [] as any[],
  };
}

function makeItem(overrides: any = {}) {
  return {
    id: 10,
    plan_id: 1,
    position: 1,
    text: "Write test plan",
    detail: null,
    acceptance: null,
    checked: false,
    parent_item_id: null,
    imported_item_id: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    claims: [],
    ...overrides,
  };
}

function makeClaim(overrides: any = {}) {
  return {
    id: 100,
    project_id: "proj-1",
    plan_id: 1,
    item_id: 10,
    value_source: "trunk_commit",
    value_ref: "abc123def456",
    source_cwd: "/repo/agent-monitor",
    label_snapshot: "Ship intake",
    seen_at_snapshot: null,
    stage_snapshot: null,
    attribution: "mechanical",
    claimed_by: "human",
    claimed_at: "2026-06-02T00:00:00.000Z",
    created_at: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeUnit(overrides: any = {}) {
  const source = overrides.source ?? "trunk_commit";
  const sourceRef = overrides.sourceRef ?? "abc123def456";
  return {
    id: `${source}:${sourceRef}`,
    source,
    sourceRef,
    attribution: "mechanical",
    discoveredAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeHealth(overrides: any = {}) {
  return {
    unclaimedPoolSize: 42,
    lastClosureAt: "2026-06-01T00:00:00.000Z",
    daysSinceLastClosure: 5,
    openPlanCount: 2,
    ...overrides,
  };
}

// Value Pool Slice 2: a CoverageSnapshot factory, mirroring the other
// make*() factories above. Default: passive, complete, empty pool — the
// coverage header renders nothing for this shape (pool_size === 0), so
// pre-Slice-2 tests that never mention coverage stay unaffected by default.
function makeCoverage(overrides: any = {}) {
  return {
    project_id: "proj-1",
    described: 0,
    pool_size: 0,
    pending: 0,
    complete: true,
    demand: "passive",
    requested_at: null,
    eta: { state: "none" },
    computed_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PlanLedgerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no altitude for any unit (LLM off/unavailable) — tests that
    // care about the resolved/generating states override this explicitly.
    mockAltitudesMock.mockResolvedValue({ altitudes: {} });
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage() });
    mockRequestCoverageMock.mockResolvedValue({
      coverage: makeCoverage({ demand: "requested", requested_at: "2026-06-01T00:00:00.000Z" }),
    });
  });

  it("renders 2 open plans with their nested items in the left pane", async () => {
    const plan1 = makePlan({ id: 1, title: "Phase 1: Intake" });
    const plan2 = makePlan({
      id: 2,
      title: "Phase 2: Claims",
      ordinal: 2,
    });
    plan1.items = [
      makeItem({ id: 10, text: "Item 1" }),
      makeItem({ id: 11, text: "Item 2", parent_item_id: 10 }),
    ];
    plan2.items = [makeItem({ id: 20, text: "Item A" })];

    mockListMock.mockResolvedValue({ plans: [plan1, plan2] });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Phase 1: Intake")).toBeInTheDocument());
    expect(screen.getByText("Phase 2: Claims")).toBeInTheDocument();

    // Child item nesting proven with within
    // Scope to the plan section, then narrow to the tree/item-list to avoid option elements
    const plan1Section = (screen
      .getByText("Phase 1: Intake")
      .closest("[data-test='plan-section']") ||
      screen.getByText("Phase 1: Intake").closest("div")) as HTMLElement;

    // Find the tree items specifically (not options in the add-item form picker)
    // by looking for elements with data-test*="item" or a tree role
    const allItem1Elements = within(plan1Section).getAllByText("Item 1");
    const item1InTree = allItem1Elements.find(
      (el) => el.closest("[data-test*='item']") && !el.tagName.includes("OPTION")
    );
    expect(item1InTree).toBeInTheDocument();

    const allItem2Elements = within(plan1Section).getAllByText("Item 2");
    const item2InTree = allItem2Elements.find(
      (el) => el.closest("[data-test*='item']") && !el.tagName.includes("OPTION")
    );
    expect(item2InTree).toBeInTheDocument();
  });

  it("renders pool units with tier badges derived from value_source", async () => {
    const plan = makePlan();
    plan.items = [];

    const units = [
      makeUnit({ source: "trunk_commit" }),
      makeUnit({ source: "intake_initiative", sourceRef: "initiative-slug" }),
      makeUnit({ source: "merge_commit", sourceRef: "def789" }),
      makeUnit({ source: "detour", sourceRef: "1" }),
    ];

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units, identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    render(<PlanLedgerPanel projectId="proj-1" />);

    // Scope to the pool pane: the plan title "Phase 1: Intake" (left pane)
    // also matches an unscoped /Intake/i query.
    await waitFor(() => {
      expect(document.querySelector('[data-test="value-pool-pane"]')).toBeTruthy();
    });
    const poolPane = document.querySelector('[data-test="value-pool-pane"]') as HTMLElement;

    await waitFor(() => {
      // Each unit source should render a badge with its tier
      expect(within(poolPane).getByText(/trunk_commit|Trunk/i)).toBeInTheDocument();
      expect(within(poolPane).getByText(/intake_initiative|Intake/i)).toBeInTheDocument();
      expect(within(poolPane).getByText(/merge_commit|Merge/i)).toBeInTheDocument();
      expect(within(poolPane).getByText(/detour|Detour/i)).toBeInTheDocument();
    });
  });

  it("calls api.projectPlans.claim exactly once with (itemId, unit) and unit disappears", async () => {
    const plan = makePlan();
    const item = makeItem();
    plan.items = [item];

    const unit = makeUnit();
    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValueOnce({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    // After claiming, pool should be empty
    mockClaimMock.mockResolvedValue({ claim: makeClaim() });
    mockPoolMock.mockResolvedValueOnce({ units: [], identityWarnings: [] });
    mockListMock.mockResolvedValueOnce({ plans: [plan] });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText(/trunk_commit|Trunk/i)).toBeInTheDocument());

    // Find the claim button in the pool area (avoid the "Add" button in the add-item form)
    const poolPane = document.querySelector('[data-test="value-pool-pane"]') as HTMLElement;
    const claimButton = within(poolPane || document.body).getByRole("button", { name: /claim/i });
    expect(claimButton).toBeInTheDocument();

    fireEvent.click(claimButton);

    await waitFor(() => {
      expect(mockClaimMock).toHaveBeenCalledTimes(1);
      expect(mockClaimMock).toHaveBeenCalledWith("proj-1", item.id, unit);
    });

    // After refetch, unit should be gone from the pool
    await waitFor(() => {
      expect(screen.queryByText(/trunk_commit|Trunk/i)).not.toBeInTheDocument();
    });
  });

  it("calls api.projectPlans.close and moves plan to collapsed closed-generations list", async () => {
    const openPlan = makePlan({ id: 1, status: "open", title: "Open Plan" });
    const closedPlan = makePlan({
      id: 2,
      status: "closed",
      title: "Closed Plan",
      closed_at: "2026-06-05T00:00:00.000Z",
      closure_note: "Completed",
    });

    mockListMock.mockResolvedValueOnce({ plans: [openPlan] });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    mockCloseMock.mockResolvedValue({ plan: closedPlan });
    mockListMock.mockResolvedValueOnce({ plans: [closedPlan] });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Open Plan")).toBeInTheDocument());

    const closeButton = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(mockCloseMock).toHaveBeenCalledTimes(1);
      expect(mockCloseMock).toHaveBeenCalledWith("proj-1", 1, expect.any(Object));
    });

    // After close, plan should move to collapsed closed history
    await waitFor(() => {
      // Open plan gone from main section
      expect(screen.queryByText("Open Plan")).not.toBeInTheDocument();
      // "History" section header and the closed plan's own title both match
      // an unscoped /closed|history/i query — assert each explicitly instead.
      expect(screen.getByText("History")).toBeInTheDocument();
      expect(screen.getByText("Closed Plan")).toBeInTheDocument();
    });
  });

  it("renders health numbers verbatim from server: 37 unclaimedPoolSize shows 37, not pool.length (§9.1)", async () => {
    const plan = makePlan();
    plan.items = [];

    // Pool has 5 units
    const units = Array.from({ length: 5 }, (_, i) => makeUnit({ sourceRef: `sha${i}` }));

    // But server says unclaimedPoolSize is 37 (verbatim number)
    const health = makeHealth({ unclaimedPoolSize: 37 });

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units, identityWarnings: [] });
    mockHealthMock.mockResolvedValue(health);

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      // Must show 37, not 5 (the array length)
      const text = screen.getByText(/37/).textContent;
      expect(text).toContain("37");
      // Verify it's not showing pool.length (5) as the unclaimed-count headline.
      const healthStrip = document.querySelector('[data-test="plan-ledger-health"]') as HTMLElement;
      expect(within(healthStrip).getByText("37")).toBeInTheDocument();
      expect(within(healthStrip).queryByText("5")).not.toBeInTheDocument();
    });
  });

  it("renders lastClosureAt: null state without NaN or Invalid Date in display", async () => {
    const plan = makePlan();
    plan.items = [];

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    // No closures yet
    mockHealthMock.mockResolvedValue(
      makeHealth({ lastClosureAt: null, daysSinceLastClosure: null })
    );

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      const containerText = document.body.textContent || "";
      expect(containerText).not.toContain("NaN");
      expect(containerText).not.toContain("Invalid Date");
      // Null/empty state should be rendered gracefully
      expect(screen.getByText(/no.*close|never|--/i) || screen.getByText(/—/)).toBeTruthy();
    });
  });

  it("closed generation exposes no item-edit/claim/unclaim affordances", async () => {
    const closedPlan = makePlan({
      id: 1,
      status: "closed",
      title: "Closed Plan",
      closed_at: "2026-06-05T00:00:00.000Z",
    });
    const item = makeItem({ plan_id: 1, claims: [makeClaim()] });
    closedPlan.items = [item];

    mockListMock.mockResolvedValue({ plans: [closedPlan] });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Closed Plan")).toBeInTheDocument());

    // Closed items should not have edit/delete/unclaim buttons
    const itemSection = screen.getByText("Closed Plan").closest("div") as HTMLElement;
    expect(
      within(itemSection).queryByRole("button", { name: /edit|delete|remove|unclaim/i })
    ).not.toBeInTheDocument();
  });

  it("does not leak raw projectDetail.* i18n keys into the DOM", async () => {
    const plan = makePlan();
    plan.items = [makeItem()];

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Phase 1: Intake")).toBeInTheDocument());

    const containerText = document.body.textContent || "";
    // No i18n key patterns like projectDetail.xxx should leak
    expect(containerText).not.toMatch(/projectDetail\.[a-zA-Z]/);
    expect(containerText).not.toMatch(/planLedger\.[a-zA-Z]/);
  });

  it("shows a generating placeholder for Project/Stakeholder before altitudes resolve, then the resolved text", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    let resolveAltitudes: (v: unknown) => void = () => {};
    mockAltitudesMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAltitudes = resolve;
      })
    );

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(document.querySelector('[data-test="pool-unit"]')).toBeTruthy();
    });
    expect(screen.getAllByText(/Generating/i).length).toBeGreaterThan(0);

    resolveAltitudes({
      altitudes: {
        [unit.id]: {
          project: "Part of the tracker.",
          stakeholder: "Shipped the tracker.",
          model: "haiku",
          generated_at: "2026-08-04T00:00:00.000Z",
          cached: false,
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Part of the tracker.")).toBeInTheDocument();
      expect(screen.getByText("Shipped the tracker.")).toBeInTheDocument();
    });
  });

  it("shows an unavailable placeholder when a unit is missing from the altitudes response", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockAltitudesMock.mockResolvedValue({ altitudes: {} });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getAllByText(/Not available/i).length).toBe(2); // Project + Stakeholder rows
    });
  });

  it("requests altitudes exactly once for a stable unit set (no re-request on an unrelated re-render)", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockAltitudesMock.mockResolvedValue({
      altitudes: {
        [unit.id]: { project: "P", stakeholder: "S", model: null, generated_at: "", cached: true },
      },
    });

    const { rerender } = render(<PlanLedgerPanel projectId="proj-1" />);
    await waitFor(() => expect(mockAltitudesMock).toHaveBeenCalledTimes(1));
    expect(mockAltitudesMock).toHaveBeenCalledWith("proj-1", [unit]);

    rerender(<PlanLedgerPanel projectId="proj-1" />);
    await waitFor(() => expect(screen.getByText("P")).toBeInTheDocument());
    expect(mockAltitudesMock).toHaveBeenCalledTimes(1);
  });

  it("a 45-unit pool renders Queued and Not available distinguishably in the same render (AC-2, T-D)", async () => {
    const plan = makePlan();
    plan.items = [];
    const units = Array.from({ length: 45 }, (_, i) => makeUnit({ id: `unit-${i}` }));

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units, identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    mockAltitudesMock.mockResolvedValue({
      altitudes: Object.fromEntries(
        units.slice(0, 39).map((u) => [u.id, { project: "P", stakeholder: "S" }])
      ),
      states: {
        [units[39].id]: "unavailable",
        ...Object.fromEntries(units.slice(40, 45).map((u) => [u.id, "queued"])),
      },
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getAllByText(/Queued/i).length).toBe(10)); // 5 units × 2 rows
    expect(screen.getAllByText(/Not available/i).length).toBe(2); // 1 unit × 2 rows
    expect(screen.getAllByText("P")[0]).toBeInTheDocument(); // at least 1 resolved unit present
  });

  it("45 unavailable units (LLM off, T-B) render distinctly from queued", async () => {
    const plan = makePlan();
    plan.items = [];
    const units = Array.from({ length: 45 }, (_, i) => makeUnit({ id: `unit-${i}` }));

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units, identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    mockAltitudesMock.mockResolvedValue({
      altitudes: {},
      states: Object.fromEntries(units.map((u) => [u.id, "unavailable"])),
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getAllByText(/Not available/i).length).toBe(90)); // 45 units × 2 rows
    expect(screen.queryAllByText(/Queued/i).length).toBe(0);
  });

  it("an out-of-registry states value warns and does not masquerade as an old-server absence (T-E)", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockAltitudesMock.mockResolvedValue({
      altitudes: {},
      states: { [unit.id]: "bogus" },
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getAllByText(/Not available/i).length).toBe(2)); // safe fallback
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]!.join(" ")).toContain("bogus");
    expect(warnSpy.mock.calls[0]!.join(" ")).toContain(unit.id);

    warnSpy.mockRestore();
  });

  it("C1: marker distinct from every other state in the same render (§9.8)", async () => {
    // One response with 5 units: (a) resolved fresh, (b) updated_unseen + stage_changed,
    // (c) updated_unseen + label_changed, (d) states queued, (e) states unavailable
    const plan = makePlan();
    plan.items = [];
    const unitA = makeUnit({ source: "trunk_commit", sourceRef: "a" });
    const unitB = makeUnit({ source: "intake_initiative", sourceRef: "b" });
    const unitC = makeUnit({ source: "intake_initiative", sourceRef: "c" });
    const unitD = makeUnit({ source: "intake_initiative", sourceRef: "d" });
    const unitE = makeUnit({ source: "intake_initiative", sourceRef: "e" });

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({
      units: [unitA, unitB, unitC, unitD, unitE],
      identityWarnings: [],
    });
    mockHealthMock.mockResolvedValue(makeHealth());

    mockAltitudesMock.mockResolvedValue({
      altitudes: {
        [unitA.id]: {
          project: "A project",
          stakeholder: "A text",
          // No freshness (resolved fresh)
        },
        [unitB.id]: {
          project: "B project",
          stakeholder: "B new text",
          freshness: "updated_unseen",
          update_reason: "stage_changed",
          regenerated_at: "2026-08-05T10:00:00Z",
        },
        [unitC.id]: {
          project: "C project",
          stakeholder: "C new text",
          freshness: "updated_unseen",
          update_reason: "label_changed",
          regenerated_at: "2026-08-05T10:00:00Z",
        },
      },
      states: {
        [unitD.id]: "queued",
        [unitE.id]: "unavailable",
      },
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("A text")).toBeTruthy();
      expect(screen.getByText("B new text")).toBeTruthy();
      expect(screen.getByText("C new text")).toBeTruthy();
    });

    // (b)/(c) ALSO render their regenerated text — the marker rides
    // alongside, never replaces (technical-plan §"Proves: C1").
    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("B new text");
    expect(bodyText).toContain("C new text");

    // No raw i18n key leak, now also covering the marker's own key.
    expect(/planLedger\.[a-zA-Z]/.test(bodyText)).toBe(false);

    // The actual marker under test: a dismiss/acknowledge control renders
    // exactly once per unit that carries `freshness: "updated_unseen"`
    // (units B and C), and is absent for a resolved-fresh unit with no
    // freshness field (unit A). Red proof (per technical-plan): disable
    // the marker branch in ValueUnitRow -> this assertion goes red, since
    // no such control exists anywhere in the render right now.
    const rowA = screen.getByText("A text").closest('[data-test="pool-unit"]');
    const rowB = screen.getByText("B new text").closest('[data-test="pool-unit"]');
    const rowC = screen.getByText("C new text").closest('[data-test="pool-unit"]');
    expect(rowA).toBeTruthy();
    expect(rowB).toBeTruthy();
    expect(rowC).toBeTruthy();

    const markerRegex = /dismiss|acknowledge|×|✕/i;
    expect(within(rowA as HTMLElement).queryByRole("button", { name: markerRegex })).toBeNull();
    expect(within(rowB as HTMLElement).getByRole("button", { name: markerRegex })).toBeTruthy();
    expect(within(rowC as HTMLElement).getByRole("button", { name: markerRegex })).toBeTruthy();

    // stage_changed and label_changed are distinguishable i18n keys, so
    // their rendered marker copy must differ from each other (not the same
    // hardcoded string for both reasons).
    const markerTextB = within(rowB as HTMLElement)
      .getByRole("button", { name: markerRegex })
      .closest("div")?.textContent;
    const markerTextC = within(rowC as HTMLElement)
      .getByRole("button", { name: markerRegex })
      .closest("div")?.textContent;
    expect(markerTextB).not.toEqual(markerTextC);
  });

  it("C1b: freshness loop (ALTITUDE_FRESHNESS) and old text never blanks", async () => {
    // Loop ALTITUDE_FRESHNESS registry, not hand-type three cases.
    // For each freshness value: unit with old text + that freshness should
    // render the text (not the queued/unavailable placeholder), in the same
    // render as a genuine "queued" and "unavailable" unit — so a wrong
    // implementation that routes stale-freshness entries into the
    // placeholder branch can't hide behind an otherwise-empty render.
    const plan = makePlan();
    plan.items = [];

    const freshnessList = ["stale_refresh_queued", "stale_refresh_unavailable", "updated_unseen"];

    const units = freshnessList.map((_freshness, i) =>
      makeUnit({ source: "intake_initiative", sourceRef: `c1b-${i}` })
    );
    const unitQueued = makeUnit({ source: "intake_initiative", sourceRef: "c1b-queued" });
    const unitUnavailable = makeUnit({ source: "intake_initiative", sourceRef: "c1b-unavail" });

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({
      units: [...units, unitQueued, unitUnavailable],
      identityWarnings: [],
    });
    mockHealthMock.mockResolvedValue(makeHealth());

    const altitudes: any = {};
    units.forEach((unit, i) => {
      altitudes[unit.id] = {
        project: "P",
        stakeholder: `Old text for ${freshnessList[i]}`,
        freshness: freshnessList[i],
        update_reason: "stage_changed",
        regenerated_at: "2026-08-05T10:00:00Z",
      };
    });

    mockAltitudesMock.mockResolvedValue({
      altitudes,
      states: {
        [unitQueued.id]: "queued",
        [unitUnavailable.id]: "unavailable",
      },
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      // Each stale-freshness entry renders its OLD text, not a placeholder —
      // and that text is distinguishable from the real queued/unavailable
      // placeholder copy rendered alongside it in the same pass.
      for (const freshness of freshnessList) {
        const text = document.body.textContent || "";
        expect(text).toContain(`Old text for ${freshness}`);
      }
    });

    const bodyText = document.body.textContent || "";
    const oldTextOccurrences = (bodyText.match(/Old text for/g) || []).length;
    expect(oldTextOccurrences).toBe(3);

    // SF-2: a `stale_refresh_queued`/`stale_refresh_unavailable` row still
    // carries its own informational hint text (asserted above via
    // "Old text for ..."), but must NOT carry a dismiss/acknowledge control
    // — that row is still serving OLD, never-regenerated text; there is
    // nothing to acknowledge, and a dismiss click there would send the
    // row's stale `regenerated_at` to the compare-and-set seen endpoint,
    // risking a mis-stamp against a later, genuinely unacknowledged
    // `updated_unseen` generation for the same unit (the T-D class DEC-17's
    // CAS exists to prevent). `updated_unseen` — the one freshness value
    // that DOES represent a just-regenerated, unacknowledged generation —
    // is the only one that keeps the control (same assertion C1 makes for
    // its own updated_unseen fixtures).
    const markerRegex = /dismiss|acknowledge|×|✕/i;
    const rowStaleQueued = screen
      .getByText("Old text for stale_refresh_queued")
      .closest('[data-test="pool-unit"]');
    expect(
      within(rowStaleQueued as HTMLElement).queryByRole("button", { name: markerRegex })
    ).toBeNull();

    const rowStaleUnavailable = screen
      .getByText("Old text for stale_refresh_unavailable")
      .closest('[data-test="pool-unit"]');
    expect(
      within(rowStaleUnavailable as HTMLElement).queryByRole("button", { name: markerRegex })
    ).toBeNull();

    const rowUpdatedUnseen = screen
      .getByText("Old text for updated_unseen")
      .closest('[data-test="pool-unit"]');
    expect(
      within(rowUpdatedUnseen as HTMLElement).getByRole("button", { name: markerRegex })
    ).toBeTruthy();
  });

  it("C2: explicit acknowledge — exactly once on button click, never auto-on-render", async () => {
    const plan = makePlan();
    plan.items = [];
    const unitA = makeUnit();
    const unitB = makeUnit({ source: "intake_initiative", sourceRef: "b" });

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({
      units: [unitA, unitB],
      identityWarnings: [],
    });
    mockHealthMock.mockResolvedValue(makeHealth());

    mockAltitudesMock.mockResolvedValue({
      altitudes: {
        [unitA.id]: {
          project: "A",
          stakeholder: "A text",
          freshness: "updated_unseen",
          update_reason: "stage_changed",
          regenerated_at: "2026-08-05T10:00:00Z",
        },
        [unitB.id]: {
          project: "B",
          stakeholder: "B text",
          // No freshness
        },
      },
      states: {},
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("A text")).toBeTruthy());
    expect(screen.getByText("B text")).toBeTruthy();

    // (a) Rendering alone never calls markAltitudesSeen (DEC-8, no
    // auto-on-render) — asserted here as a real precondition for (b)/(c)
    // below, not as the whole test.
    expect(mockMarkSeenMock).not.toHaveBeenCalled();

    // (b) Click per-unit dismiss control on unit A (has freshness) →
    // markAltitudesSeen called exactly once. Red proof (per technical-plan):
    // double-fire the handler → the exactly-once assertion goes red; today
    // it's red because no such button exists to click at all.
    const rowA = screen.getByText("A text").closest('[data-test="pool-unit"]');
    const dismissButtonA = within(rowA as HTMLElement).getByRole("button", {
      name: /dismiss|acknowledge|×|✕/i,
    });
    fireEvent.click(dismissButtonA);

    await waitFor(() => expect(mockMarkSeenMock).toHaveBeenCalledTimes(1));

    // Unit B carries no freshness, so it must have no dismiss control at
    // all — nothing to click, nothing to acknowledge.
    const rowB = screen.getByText("B text").closest('[data-test="pool-unit"]');
    expect(
      within(rowB as HTMLElement).queryByRole("button", { name: /dismiss|acknowledge|×|✕/i })
    ).toBeNull();
  });

  it("C3: compat, degradation, and unknown values", async () => {
    const plan = makePlan();
    plan.items = [];
    const unitOld = makeUnit({ source: "trunk_commit", sourceRef: "old" });
    const unitUnknown = makeUnit({ source: "intake_initiative", sourceRef: "unknown" });
    const unitBogusState = makeUnit({ source: "intake_initiative", sourceRef: "bogus" });

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({
      units: [unitOld, unitUnknown, unitBogusState],
      identityWarnings: [],
    });
    mockHealthMock.mockResolvedValue(makeHealth());

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // (a) Old-server response (entries with no freshness fields)
    mockAltitudesMock.mockResolvedValue({
      altitudes: {
        [unitOld.id]: {
          project: "Old",
          stakeholder: "Old server text",
          // No freshness, no update_reason
        },
        [unitUnknown.id]: {
          project: "Unknown",
          stakeholder: "Unknown text",
          freshness: "unknown_freshness_xyz",
          update_reason: "something_changed",
          regenerated_at: "2026-08-05T10:00:00Z",
        },
      },
      states: {
        [unitBogusState.id]: "bogus_state_xyz",
      },
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Old server text")).toBeTruthy());

    // (a) Old-server entries (no freshness fields at all) render as-is, with
    // NO marker/dismiss control — this is the actual "no marker" claim, not
    // just "the text renders" (which is true whether or not the feature
    // exists at all).
    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Old server text");
    const rowOld = screen.getByText("Old server text").closest('[data-test="pool-unit"]');
    expect(
      within(rowOld as HTMLElement).queryByRole("button", { name: /dismiss|acknowledge|×|✕/i })
    ).toBeNull();

    // (b) Unknown freshness value warns to console, specifically — isolated
    // from (c)'s pre-existing out-of-registry `states` warn below by
    // checking the warn call's own message, not just "warn was called at
    // all" (that assertion would already pass today from (c) alone, proving
    // nothing about the NEW freshness registry).
    const freshnessWarnCall = warnSpy.mock.calls.find((call) =>
      String(call[0]).includes("unknown_freshness_xyz")
    );
    expect(freshnessWarnCall).toBeTruthy();

    // (c) Existing out-of-registry states value still works and warns
    expect(bodyText).toContain("Unknown text");
    const statesWarnCall = warnSpy.mock.calls.find((call) =>
      String(call[0]).includes("bogus_state_xyz")
    );
    expect(statesWarnCall).toBeTruthy();

    // (d) Unknown update_reason → generic copy from i18n, no raw key leak
    // The test verifies that a reason like "something_changed" routes to the generic
    // "updated" key, not a literal "planLedger.pool.altitudes.updatedSomethingChanged"
    const hasRawKey = /planLedger\.pool\.altitudes\.[a-zA-Z]/.test(bodyText);
    expect(hasRawKey).toBe(false);

    warnSpy.mockRestore();
  });

  it("C-registry: hand-typed registries move together (WATCH-E/F)", async () => {
    // The three hand-typed client registries (Altitude union, the
    // states Record type, and ALTITUDE_FRESHNESS) aren't exported for
    // direct inspection, so this is a black-box baseline: an empty pool
    // renders its real empty-state copy with no warnings and no marker
    // scaffolding left over — a component that hard-crashes or warns
    // unconditionally when the new freshness registry is wired in would
    // fail this. §9.7 accepted exception (WATCH-F) — this cannot fully
    // close the trap by itself; C1/C1b/C3 close the behavioral legs.
    const plan = makePlan();
    plan.items = [];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockAltitudesMock.mockResolvedValue({ altitudes: {}, states: {} });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("Nothing unclaimed right now.")).toBeTruthy();
    });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-test="pool-unit"]')).toHaveLength(0);

    warnSpy.mockRestore();
  });
});

describe("PlanLedgerPanel: Value Pool Slice 2 coverage header (DEC-1, DEC-5, R4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAltitudesMock.mockResolvedValue({ altitudes: {} });
  });

  it("cold start renders the named 'estimating' copy — never a minutes string, never '0'", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockCoverageMock.mockResolvedValue({
      coverage: makeCoverage({
        described: 0,
        pool_size: 1,
        pending: 1,
        complete: false,
        eta: { state: "estimating" },
      }),
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(document.querySelector('[data-test="coverage-header"]')).toBeInTheDocument();
    });
    const headerText = document.querySelector('[data-test="coverage-header"]')!.textContent || "";
    expect(headerText).toContain("Estimating");
    expect(headerText).not.toMatch(/~0 min/);
    expect(headerText).not.toMatch(/\bmin remaining\b/);
  });

  it("a 'measured' ETA renders the minutes-remaining copy from the server-provided ms_remaining, never re-derived", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockCoverageMock.mockResolvedValue({
      coverage: makeCoverage({
        described: 3,
        pool_size: 5,
        pending: 2,
        complete: false,
        eta: {
          state: "measured",
          ms_remaining: 120_000,
          per_batch_ms: 60_000,
          batches_remaining: 2,
        },
      }),
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(document.querySelector('[data-test="coverage-header"]')).toBeInTheDocument();
    });
    const headerText = document.querySelector('[data-test="coverage-header"]')!.textContent || "";
    expect(headerText).toContain("3 of 5 described");
    expect(headerText).toContain("~2 min remaining"); // 120_000ms / 60_000 = 2 minutes, unit conversion only
  });

  it("a complete, passive pool shows no 'prioritize now' button", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockCoverageMock.mockResolvedValue({
      coverage: makeCoverage({ described: 1, pool_size: 1, pending: 0, complete: true }),
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(document.querySelector('[data-test="coverage-header"]')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-test="prioritize-now-button"]')).toBeNull();
  });

  it("'prioritize now' calls api.projectPlans.requestCoverage and reflects the returned demand", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockCoverageMock.mockResolvedValue({
      coverage: makeCoverage({ described: 0, pool_size: 1, pending: 1, complete: false }),
    });
    mockRequestCoverageMock.mockResolvedValue({
      coverage: makeCoverage({
        described: 0,
        pool_size: 1,
        pending: 1,
        complete: false,
        demand: "requested",
        requested_at: "2026-06-05T00:00:00.000Z",
        computed_at: "2026-06-05T00:00:00.000Z",
      }),
    });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(document.querySelector('[data-test="prioritize-now-button"]')).toBeInTheDocument();
    });
    fireEvent.click(document.querySelector('[data-test="prioritize-now-button"]')!);

    expect(mockRequestCoverageMock).toHaveBeenCalledWith("proj-1");
    await waitFor(() => {
      expect(screen.getByText("Prioritization requested")).toBeInTheDocument();
    });
  });

  it("BL-2 regression: under React 18 StrictMode's setup->cleanup->setup double-invoke, altitude text still renders and 'prioritize now' does not stay disabled forever", async () => {
    const { eventBus } = await import("../../lib/eventBus");
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockCoverageMock.mockResolvedValue({
      coverage: makeCoverage({ described: 0, pool_size: 1, pending: 1, complete: false }),
    });
    mockAltitudesMock.mockResolvedValue({
      altitudes: {
        [unit.id]: {
          project: "Part of the tracker.",
          stakeholder: "Shipped the tracker.",
          model: "haiku",
          generated_at: "2026-08-04T00:00:00.000Z",
          cached: true,
        },
      },
    });
    mockRequestCoverageMock.mockResolvedValue({
      coverage: makeCoverage({
        described: 0,
        pool_size: 1,
        pending: 1,
        complete: false,
        demand: "requested",
        requested_at: "2026-06-05T00:00:00.000Z",
        computed_at: "2026-06-05T00:00:00.000Z",
      }),
    });

    render(
      <StrictMode>
        <PlanLedgerPanel projectId="proj-1" />
      </StrictMode>
    );

    // If `mountedRef` is never re-armed on StrictMode's second effect setup
    // (build-reviewer BL-2), `fetchAltitudesFor`'s resolved response is
    // silently dropped and this text never appears in `npm run dev`.
    await waitFor(() => {
      expect(screen.getByText("Part of the tracker.")).toBeInTheDocument();
      expect(screen.getByText("Shipped the tracker.")).toBeInTheDocument();
    });

    // Click "prioritize now" — this sets `requestingCoverage(true)` and, on
    // a REAL server, the response's `demand` always flips away from
    // "passive" (never back to it), so the button itself unmounts here
    // (expected, not the bug under test).
    await waitFor(() => {
      expect(document.querySelector('[data-test="prioritize-now-button"]')).toBeInTheDocument();
    });
    fireEvent.click(document.querySelector('[data-test="prioritize-now-button"]')!);
    await waitFor(() => {
      expect(mockRequestCoverageMock).toHaveBeenCalledWith("proj-1");
      expect(document.querySelector('[data-test="prioritize-now-button"]')).toBeNull();
    });

    // Simulate the request later reverting to passive again (DEC-8 TTL
    // expiry, or a no-progress drain exit reported via a fresh WS
    // broadcast) while the pool is still incomplete — the button re-mounts.
    // If `handlePrioritizeNow`'s `finally` never cleared `requestingCoverage`
    // (BL-2, because `mountedRef.current` was stuck `false`), this fresh
    // button renders permanently `disabled` from the moment it appears —
    // the exact "stuck forever" symptom build-reviewer flagged.
    eventBus.publish({
      type: "value_altitudes_updated",
      timestamp: "2026-06-05T10:10:00.000Z",
      data: {
        project_id: "proj-1",
        unit_keys: [],
        pending: 1,
        coverage: makeCoverage({
          described: 0,
          pool_size: 1,
          pending: 1,
          complete: false,
          demand: "passive",
          requested_at: null,
          computed_at: "2026-06-05T10:10:00.000Z",
        }),
      },
    });

    await waitFor(() => {
      const reappeared = document.querySelector(
        '[data-test="prioritize-now-button"]'
      ) as HTMLButtonElement | null;
      expect(reappeared).toBeInTheDocument();
      expect(reappeared!.disabled).toBe(false);
    });
  });

  it("R4: out-of-order snapshot delivery does not regress the header — a stale (older computed_at) WS message never overwrites a newer one", async () => {
    const { eventBus } = await import("../../lib/eventBus");
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockCoverageMock.mockResolvedValue({
      coverage: makeCoverage({
        described: 1,
        pool_size: 5,
        pending: 4,
        complete: false,
        computed_at: "2026-06-05T10:00:00.000Z",
      }),
    });

    render(<PlanLedgerPanel projectId="proj-1" />);
    await waitFor(() => {
      expect(document.querySelector('[data-test="coverage-header"]')!.textContent).toContain(
        "1 of 5 described"
      );
    });

    // A NEWER snapshot arrives first (e.g. the drain raced ahead) —
    // must be accepted and rendered.
    eventBus.publish({
      type: "value_altitudes_updated",
      timestamp: "2026-06-05T10:05:00.000Z",
      data: {
        project_id: "proj-1",
        unit_keys: [],
        pending: 1,
        coverage: makeCoverage({
          described: 4,
          pool_size: 5,
          pending: 1,
          complete: false,
          computed_at: "2026-06-05T10:05:00.000Z", // NEWER
        }),
      },
    });
    await waitFor(() => {
      expect(document.querySelector('[data-test="coverage-header"]')!.textContent).toContain(
        "4 of 5 described"
      );
    });

    // A STALE (older computed_at) snapshot arrives afterward (an
    // out-of-order HTTP/WS race) — must be REJECTED, not regress the header.
    eventBus.publish({
      type: "value_altitudes_updated",
      timestamp: "2026-06-05T10:01:00.000Z",
      data: {
        project_id: "proj-1",
        unit_keys: [],
        pending: 4,
        coverage: makeCoverage({
          described: 1,
          pool_size: 5,
          pending: 4,
          complete: false,
          computed_at: "2026-06-05T10:01:00.000Z", // OLDER than what's held
        }),
      },
    });

    // Give React a tick to (not) re-render, then assert the header STILL
    // shows the newer value — a regression here would be "decrement wearing
    // a race's clothes" (architect R4).
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector('[data-test="coverage-header"]')!.textContent).toContain(
      "4 of 5 described"
    );
  });

  it("WATCH-S2-B: a value_altitudes_updated message refetches ONLY the named unit_keys' altitude text, never re-fetches coverage from the server", async () => {
    const { eventBus } = await import("../../lib/eventBus");
    const plan = makePlan();
    plan.items = [];
    const unit1 = makeUnit({ id: "trunk_commit:u1", sourceRef: "u1" });
    const unit2 = makeUnit({ id: "trunk_commit:u2", sourceRef: "u2" });

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit1, unit2], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage({ pool_size: 2, pending: 2 }) });

    render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      // Initial mount fetch: both units requested once.
      expect(mockAltitudesMock).toHaveBeenCalledTimes(1);
    });
    const coverageCallCountAfterMount = mockCoverageMock.mock.calls.length;
    mockAltitudesMock.mockClear();

    eventBus.publish({
      type: "value_altitudes_updated",
      timestamp: "2026-06-05T10:05:00.000Z",
      data: {
        project_id: "proj-1",
        unit_keys: [unit1.id],
        pending: 1,
        coverage: makeCoverage({
          pool_size: 2,
          pending: 1,
          computed_at: "2026-06-05T10:05:00.000Z",
        }),
      },
    });

    await waitFor(() => {
      expect(mockAltitudesMock).toHaveBeenCalledTimes(1);
    });
    // Only unit1 (the named unit_keys entry) is re-requested, never unit2.
    const [, calledUnits] = mockAltitudesMock.mock.calls[0]!;
    expect(calledUnits).toHaveLength(1);
    expect((calledUnits as any[])[0].id).toBe(unit1.id);
    // The message's own `coverage` field was used directly — GET /coverage
    // was never called again as a result of this WS message.
    expect(mockCoverageMock.mock.calls.length).toBe(coverageCallCountAfterMount);
  });

  // Helper: reusable assertion for SF-9 durable cure and all future legs added to Promise.all.
  // Takes no coverage-specific arguments; asserts core content presence only.
  //
  // B3 (build-reviewer): the previous version of this helper's third check
  // (`screen.queryByRole("alert")`) could never match anything —
  // `PlanLedgerPanel.tsx`'s error banner had no ARIA role, so the guarded
  // branch below it was dead code re-asserting what was already asserted
  // two lines up. The banner now carries `role="alert"`
  // (`PlanLedgerPanel.tsx`, the `{error && (...)}` block), so this is a
  // genuinely reachable assertion: for a caller invoking this helper in a
  // pure-degradation scenario (a leg failed but was isolated, `error`
  // itself was never set), there must be NO full-panel error banner
  // present at all — a future leg that re-introduces the SF-9 bug (folding
  // its failure back into the blocking `Promise.all`/`catch`) would set
  // `error` and populate this banner, and this assertion would then
  // genuinely fail.
  function expectPanelCoreIntact(screen: typeof import("@testing-library/react").screen) {
    // Plan title must be present
    expect(screen.getByText("Phase 1: Intake")).toBeInTheDocument();
    // Pool unit must be present
    expect(document.querySelector('[data-test="pool-unit"]')).toBeInTheDocument();
    // No full-panel error banner is present, replacing core content.
    expect(screen.queryByRole("alert")).toBeNull();
  }

  it("SF-9: a failing GET /coverage degrades gracefully — plans and pool still render, not blanked behind an error banner", async () => {
    const plan = makePlan();
    plan.items = [];
    const unit = makeUnit();

    mockListMock.mockResolvedValue({ plans: [plan] });
    mockPoolMock.mockResolvedValue({ units: [unit], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    // Coverage fetch fails
    mockCoverageMock.mockRejectedValue(new Error("coverage endpoint 500"));

    render(<PlanLedgerPanel projectId="proj-1" />);

    // Wait for core content to render
    await waitFor(() => {
      expectPanelCoreIntact(screen);
    });

    // Coverage header is absent (honest degradation)
    expect(document.querySelector('[data-test="coverage-header"]')).not.toBeInTheDocument();
  });

  it("SF-8: switching projectId does not leak the previous project's coverage snapshot under the new project's pool", async () => {
    const plan1 = makePlan({ title: "Project A Plan" });
    plan1.items = [];
    const unit1 = makeUnit();

    const plan2 = makePlan({ title: "Project B Plan" });
    plan2.items = [];
    const unit2 = makeUnit({ sourceRef: "diff-unit" });

    // Mock coverage keyed by projectId
    mockCoverageMock.mockImplementation((projectId: string) => {
      if (projectId === "proj-A") {
        return Promise.resolve({
          coverage: makeCoverage({
            project_id: "proj-A",
            described: 10,
            pool_size: 10,
            pending: 0,
            complete: true,
            computed_at: "2026-06-10T12:00:00.000Z", // NEWER (prevents merge on old)
          }),
        });
      } else if (projectId === "proj-B") {
        return Promise.resolve({
          coverage: makeCoverage({
            project_id: "proj-B",
            described: 3,
            pool_size: 20,
            pending: 17,
            complete: false,
            computed_at: "2026-06-01T09:00:00.000Z", // OLDER
          }),
        });
      }
      return Promise.resolve({ coverage: makeCoverage() });
    });

    // Mock list/pool/health keyed by projectId
    mockListMock.mockImplementation((projectId: string) => {
      if (projectId === "proj-A") {
        return Promise.resolve({ plans: [plan1] });
      } else if (projectId === "proj-B") {
        return Promise.resolve({ plans: [plan2] });
      }
      return Promise.resolve({ plans: [] });
    });

    mockPoolMock.mockImplementation((projectId: string) => {
      if (projectId === "proj-A") {
        return Promise.resolve({ units: [unit1], identityWarnings: [] });
      } else if (projectId === "proj-B") {
        return Promise.resolve({ units: [unit2], identityWarnings: [] });
      }
      return Promise.resolve({ units: [], identityWarnings: [] });
    });

    mockHealthMock.mockResolvedValue(makeHealth());

    // Initial render with proj-A
    const { rerender } = render(<PlanLedgerPanel projectId="proj-A" />);

    // Wait for proj-A's header "10 of 10 described"
    await waitFor(() => {
      const header = document.querySelector('[data-test="coverage-header"]');
      expect(header?.textContent).toContain("10 of 10 described");
    });

    // Verify A's pool_size is in the header
    const headerA = document.querySelector('[data-test="coverage-header"]')!.textContent || "";
    expect(headerA).toContain("10 of 10");

    // Rerender same instance with proj-B (simulates ProjectDetail.tsx:1292's unkeyed render)
    rerender(<PlanLedgerPanel projectId="proj-B" />);

    // Wait for proj-B's header "3 of 20 described"
    await waitFor(() => {
      const header = document.querySelector('[data-test="coverage-header"]');
      expect(header?.textContent).toContain("3 of 20 described");
    });

    // Verify B's header is present
    const headerB = document.querySelector('[data-test="coverage-header"]')!.textContent || "";
    expect(headerB).toContain("3 of 20");
    // Verify A's old value is gone
    expect(headerB).not.toContain("10 of 10");
  });

  it("SF-8 (in-flight): a response for a project no longer mounted must not land — guards against race when project A's fetch is still in flight when switching to project B", async () => {
    const plan1 = makePlan({ title: "Project A Plan" });
    plan1.items = [];
    const unit1 = makeUnit();

    const plan2 = makePlan({ title: "Project B Plan" });
    plan2.items = [];
    const unit2 = makeUnit({ sourceRef: "diff-unit" });

    // Deferred promises for proj-A — we control when these resolve
    let resolveACoverage: any;
    const aCoveragePromise = new Promise((resolve) => {
      resolveACoverage = resolve;
    });

    let resolveAList: any;
    const aListPromise = new Promise((resolve) => {
      resolveAList = resolve;
    });

    let resolveAPool: any;
    const aPoolPromise = new Promise((resolve) => {
      resolveAPool = resolve;
    });

    let resolveAHealth: any;
    const aHealthPromise = new Promise((resolve) => {
      resolveAHealth = resolve;
    });

    // Immediate promises for proj-B
    const bCoveragePromise = Promise.resolve({
      coverage: makeCoverage({
        project_id: "proj-B",
        described: 3,
        pool_size: 20,
        pending: 17,
        complete: false,
        computed_at: "2026-06-01T09:00:00.000Z", // OLDER than A's
      }),
    });

    const bListPromise = Promise.resolve({ plans: [plan2] });
    const bPoolPromise = Promise.resolve({ units: [unit2], identityWarnings: [] });
    const bHealthPromise = Promise.resolve(makeHealth());

    // Mock coverage keyed by projectId — A returns deferred, B returns immediate
    mockCoverageMock.mockImplementation((projectId: string) => {
      if (projectId === "proj-A") {
        return aCoveragePromise;
      } else if (projectId === "proj-B") {
        return bCoveragePromise;
      }
      return Promise.resolve({ coverage: makeCoverage() });
    });

    // Mock list/pool/health keyed by projectId — A returns deferred, B returns immediate
    mockListMock.mockImplementation((projectId: string) => {
      if (projectId === "proj-A") {
        return aListPromise;
      } else if (projectId === "proj-B") {
        return bListPromise;
      }
      return Promise.resolve({ plans: [] });
    });

    mockPoolMock.mockImplementation((projectId: string) => {
      if (projectId === "proj-A") {
        return aPoolPromise;
      } else if (projectId === "proj-B") {
        return bPoolPromise;
      }
      return Promise.resolve({ units: [], identityWarnings: [] });
    });

    mockHealthMock.mockImplementation((projectId: string) => {
      if (projectId === "proj-A") {
        return aHealthPromise;
      } else if (projectId === "proj-B") {
        return bHealthPromise;
      }
      return Promise.resolve(makeHealth());
    });

    // Initial render with proj-A
    const { rerender } = render(<PlanLedgerPanel projectId="proj-A" />);

    // DO NOT WAIT for proj-A to resolve. Immediately switch to proj-B.
    // This simulates a user clicking from project A's detail to project B's
    // while A's /coverage (and other legs) are still in flight.
    rerender(<PlanLedgerPanel projectId="proj-B" />);

    // Now wait for proj-B's content to render (B's promises are immediate)
    await waitFor(() => {
      const header = document.querySelector('[data-test="coverage-header"]');
      expect(header?.textContent).toContain("3 of 20 described");
    });

    // Verify B's header is present
    const headerB = document.querySelector('[data-test="coverage-header"]')!.textContent || "";
    expect(headerB).toContain("3 of 20");

    // NOW resolve proj-A's deferred promises with NEWER computed_at timestamps
    // (so the merge would prefer A if the guard were disabled).
    resolveAList({ plans: [plan1] });
    resolveAPool({ units: [unit1], identityWarnings: [] });
    resolveAHealth(makeHealth());
    resolveACoverage({
      coverage: makeCoverage({
        project_id: "proj-A",
        described: 10,
        pool_size: 10,
        pending: 0,
        complete: true,
        computed_at: "2026-06-10T12:00:00.000Z", // NEWER — would win the merge if not guarded
      }),
    });

    // Let microtasks drain
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert that B's honest, older data is still rendered — A's stale-but-newer
    // response must have been dropped by the currentProjectIdRef guard.
    const headerBAfter = document.querySelector('[data-test="coverage-header"]')!.textContent || "";
    expect(headerBAfter).toContain("3 of 20");
    expect(headerBAfter).not.toContain("10 of 10");

    // Also verify the plan title is still "Project B Plan", not "Project A Plan"
    expect(screen.getByText("Project B Plan")).toBeInTheDocument();
    expect(screen.queryByText("Project A Plan")).not.toBeInTheDocument();
  });
});

describe("PlanLedgerPanel: item CRUD + hierarchy picker (Slice 4a, DEC-S4-3/S4-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: coverage is available — tests override if needed
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage() });
    mockAltitudesMock.mockResolvedValue({ altitudes: {} });
  });

  it("C1: add-item form on open plan calls addItem with exact {text}, no stray keys", async () => {
    // Create test data with an item count
    const plan = makePlan({ id: 1, plan: { id: 1, project_id: "proj-c1" } });
    const item = makeItem({ id: 1, text: "existing" });
    plan.items = [item];

    // Mock API responses
    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockAddItemMock.mockResolvedValue({
      item: makeItem({ id: 10, text: "New top-level item" }),
    });
    mockListMock.mockResolvedValue({
      plans: [{ ...plan, items: [item, makeItem({ id: 10, text: "New top-level item" })] }],
      closedCount: 0,
      latestClosure: null,
    });

    render(<PlanLedgerPanel projectId="proj-c1" />);

    // Wait for list to load
    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    // Find the add-item form (unconditional - must exist, test fails if not)
    const form = screen.getByTestId("add-item-form");

    // Type in the text input
    const textInput = within(form).getByPlaceholderText(/add.*item/i);
    fireEvent.change(textInput, { target: { value: "New top-level item" } });

    // Submit
    const submitBtn = within(form).getByTestId("add-item-submit");
    fireEvent.click(submitBtn);

    // Verify addItem called with plan id (1), not project id
    await waitFor(() => {
      expect(mockAddItemMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ text: "New top-level item" })
      );
    });

    // Verify no stray keys (unconditional)
    expect(mockAddItemMock).toHaveBeenCalled();
    const lastCall = mockAddItemMock.mock.calls[mockAddItemMock.mock.calls.length - 1];
    const payload = lastCall[1];
    expect(Object.keys(payload).sort()).toEqual(["text"]);
  });

  it("C2A: add-item with parent selected calls addItem with {text, parent_item_id}", async () => {
    const plan = makePlan({ id: 2, plan: { id: 2, project_id: "proj-c2" } });
    const parent = makeItem({ id: 40, text: "Parent" });
    plan.items = [parent];

    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockAddItemMock.mockResolvedValue({
      item: makeItem({ id: 50, text: "Child", parent_item_id: 40 }),
    });

    render(<PlanLedgerPanel projectId="proj-c2" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    const form = screen.getByTestId("add-item-form");

    // Select parent and add child
    const textInput = within(form).getByPlaceholderText(/add.*item/i);
    fireEvent.change(textInput, { target: { value: "Child" } });

    const parentSelect = within(form).getByRole("combobox", { name: /parent/i });
    fireEvent.change(parentSelect, { target: { value: "40" } });

    const submitBtn = within(form).getByTestId("add-item-submit");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockAddItemMock).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ text: "Child", parent_item_id: 40 })
      );
    });
  });

  it("C2B: closed plan has no add-item form (absent from DOM, not disabled)", async () => {
    const plan = makePlan({ id: 11, status: "closed" });
    plan.items = [makeItem({ id: 101, text: "Existing Item" })];

    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 1,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    render(<PlanLedgerPanel projectId="proj-c2b" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    // The plan must actually render in the closed pane, not the open one —
    // otherwise this proves nothing about closed-plan behavior.
    expect(screen.getByText("Existing Item")).toBeInTheDocument();

    // Verify add-item form is absent (not just disabled) for a closed plan.
    const form = screen.queryByTestId("add-item-form");
    expect(form).not.toBeInTheDocument();
  });

  it("C3: cross-consumer equality over reordered input (ItemTree and picker derive same {id, depth}[])", async () => {
    // 3-level fixture: R → Citem → Gitem, plus R2
    const plan = makePlan({ id: 3 });
    const r = makeItem({ id: 1, text: "R", parent_item_id: null });
    const citem = makeItem({ id: 2, text: "Citem", parent_item_id: 1 });
    const gitem = makeItem({ id: 3, text: "Gitem", parent_item_id: 2 });
    const r2 = makeItem({ id: 4, text: "R2", parent_item_id: null });
    plan.items = [r, citem, gitem, r2];

    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    const { rerender } = render(<PlanLedgerPanel projectId="proj-c3" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    // Derive a real {id: depth} map from each consumer, then compare the
    // maps directly — count equality alone can't catch a consumer that
    // agrees on "how many" but disagrees on "which item is how deep"
    // (exactly the shape §9.1 DERIVED-DUAL-VIEW has bitten this project on
    // before).
    function treeDepthMap() {
      const rows = screen.getAllByTestId(/^item-row-\d+$/);
      expect(rows.length).toBeGreaterThan(0);
      const map: Record<number, number> = {};
      for (const el of rows) {
        const idMatch = el.getAttribute("data-testid")?.match(/^item-row-(\d+)$/);
        const depthAttr = el.getAttribute("data-depth");
        if (!idMatch || depthAttr === null) {
          throw new Error("item-row missing id or data-depth — cannot derive tree map");
        }
        map[Number(idMatch[1])] = Number(depthAttr);
      }
      return map;
    }

    function pickerDepthMap() {
      const options = screen
        .getAllByRole("option")
        .filter((opt) => opt.textContent?.trim() !== "Top-level");
      expect(options.length).toBeGreaterThan(0);
      const map: Record<number, number> = {};
      for (const opt of options) {
        const id = Number((opt as HTMLOptionElement).value);
        const text = opt.textContent || "";
        const match = text.match(/^(\s*)/);
        const indent = match ? match[0].length : 0;
        map[id] = Math.floor(indent / 2);
      }
      return map;
    }

    const treeMapBefore = treeDepthMap();
    const pickerMapBefore = pickerDepthMap();

    // Genuine cross-consumer equality: same ids, same depth per id — not
    // merely the same count of entries.
    expect(pickerMapBefore).toEqual(treeMapBefore);
    // And pin the actual expected shape so a bug that shifts both consumers
    // identically (matching each other, but both wrong) still gets caught.
    expect(treeMapBefore).toEqual({ 1: 0, 2: 1, 3: 2, 4: 0 });

    // Re-render with reordered items via a different projectId to trigger a
    // genuine re-fetch (PlanLedgerPanel refetches on projectId change).
    plan.items = [r2, gitem, r, citem]; // shuffled
    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });

    rerender(<PlanLedgerPanel projectId="proj-c3-alt" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalledTimes(2);
    });

    // Depth is structural (derived from parent_item_id), not order-dependent
    // — reordering the input array must not change either consumer's map,
    // and the two consumers must still agree with each other.
    const treeMapAfter = treeDepthMap();
    const pickerMapAfter = pickerDepthMap();
    expect(pickerMapAfter).toEqual(treeMapAfter);
    expect(treeMapAfter).toEqual(treeMapBefore);
  });

  it("C4A: claiming into sub-item calls claim with sub-item id", async () => {
    const plan = makePlan({ id: 4 });
    const parent = makeItem({ id: 20, text: "Parent" });
    const subitem = makeItem({ id: 30, text: "Sub", parent_item_id: 20 });
    plan.items = [parent, subitem];

    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({
      units: [makeUnit({ source: "detour", sourceRef: "c4-unit" })],
      identityWarnings: [],
    });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockClaimMock.mockResolvedValue({ claim: makeClaim({ item_id: 30 }) });

    render(<PlanLedgerPanel projectId="proj-c4" />);

    await waitFor(() => {
      expect(mockPoolMock).toHaveBeenCalled();
    });

    // Select subitem in claim picker (unconditional - must exist)
    const select = screen.getByRole("combobox", { name: /claim.*into/i });
    fireEvent.change(select, { target: { value: "30" } });

    // Click claim button (unconditional - must exist)
    const claimBtn = screen.getByRole("button", { name: /claim/i });
    fireEvent.click(claimBtn);

    await waitFor(() => {
      expect(mockClaimMock).toHaveBeenCalledWith("proj-c4", 30, expect.any(Object));
    });
  });

  it("C4B: plan with zero items → no claim control; after add-item → claim control appears enabled", async () => {
    const plan = makePlan({ id: 5 });
    plan.items = []; // No items

    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({
      units: [makeUnit()],
      identityWarnings: [],
    });
    mockHealthMock.mockResolvedValue(makeHealth());

    const { rerender } = render(<PlanLedgerPanel projectId="proj-c4b" />);

    await waitFor(() => {
      expect(mockPoolMock).toHaveBeenCalled();
    });

    // Verify no claim control (no select element for claim target)
    let claimSelect = screen.queryByRole("combobox", { name: /claim.*into/i });
    expect(claimSelect).not.toBeInTheDocument();

    // Simulate adding an item (update mock to return plan with item)
    const newItem = makeItem({ id: 100, text: "First item" });
    plan.items = [newItem];
    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });

    rerender(<PlanLedgerPanel projectId="proj-c4b-alt" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    // Verify claim control now appears and is enabled (unconditional)
    claimSelect = screen.getByRole("combobox", { name: /claim.*into/i });
    expect(claimSelect).toBeEnabled();
  });

  it("C5: edit text-only calls updateItem with {text}, no parent_item_id key", async () => {
    const plan = makePlan({ id: 6 });
    const item = makeItem({ id: 60, text: "Original" });
    plan.items = [item];

    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockUpdateItemMock.mockResolvedValue({ item: makeItem({ id: 60, text: "Edited" }) });

    render(<PlanLedgerPanel projectId="proj-c5" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    // Find the item row first by looking for all elements with "Original" text
    // and picking the one that's NOT an option (use getAllByText and filter)
    const allOriginalElements = screen.getAllByText("Original");
    const itemRowSpan = allOriginalElements.find((el) => el.tagName !== "OPTION");
    const rowContainer =
      itemRowSpan?.closest("[data-test*='item']") ||
      itemRowSpan?.parentElement?.parentElement ||
      itemRowSpan?.parentElement;

    // Find and click edit button within this row
    const editBtn = within(rowContainer!).getByTestId("item-edit-button");
    fireEvent.click(editBtn);

    // Edit text (unconditional - must exist)
    const textInput = within(rowContainer!).getByTestId("item-edit-text");
    fireEvent.change(textInput, { target: { value: "Edited" } });

    // Save (unconditional - must exist)
    const saveBtn = within(rowContainer!).getByTestId("item-edit-save");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateItemMock).toHaveBeenCalled();
    });

    const call = mockUpdateItemMock.mock.calls[0];
    expect(call[0]).toEqual(60); // item id
    expect(call[1]).toEqual({ text: "Edited" });
    // Verify no parent_item_id key at all
    expect(Object.keys(call[1])).toEqual(["text"]);
  });

  it("C6A: re-parent calls updateItem with chosen parent_item_id", async () => {
    const plan = makePlan({ id: 7 });
    const a = makeItem({ id: 61, text: "A" });
    const b = makeItem({ id: 62, text: "B" });
    plan.items = [a, b];

    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockUpdateItemMock.mockResolvedValue({ item: makeItem({ id: 61, parent_item_id: 62 }) });

    render(<PlanLedgerPanel projectId="proj-c6a" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    // Find the A item row - must avoid the option in the picker
    const allAElements = screen.getAllByText("A");
    const aItemSpan = allAElements.find((el) => el.tagName !== "OPTION");
    const aRowContainer =
      aItemSpan?.closest("[data-test*='item']") ||
      aItemSpan?.parentElement?.parentElement ||
      aItemSpan?.parentElement;

    // Click edit (unconditional - must exist)
    const editBtn = within(aRowContainer!).getByTestId("item-edit-button");
    fireEvent.click(editBtn);

    // Select parent (unconditional - must exist)
    const parentSelect = within(aRowContainer!).getByTestId("item-parent-select");
    fireEvent.change(parentSelect, { target: { value: "62" } });

    // Save (unconditional - must exist)
    const saveBtn = within(aRowContainer!).getByTestId("item-edit-save");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateItemMock).toHaveBeenCalled();
    });

    const call = mockUpdateItemMock.mock.calls[0];
    expect(call[0]).toEqual(61);
    expect(call[1]).toEqual(expect.objectContaining({ parent_item_id: 62 }));
  });

  it("C6B: promote to top-level sends explicit parent_item_id: null", async () => {
    const plan = makePlan({ id: 8 });
    const parent = makeItem({ id: 70, text: "Parent" });
    const child = makeItem({ id: 71, text: "Child", parent_item_id: 70 });
    plan.items = [parent, child];

    mockListMock.mockResolvedValue({
      plans: [plan],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());
    mockUpdateItemMock.mockResolvedValue({ item: makeItem({ id: 71, parent_item_id: null }) });

    render(<PlanLedgerPanel projectId="proj-c6b" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    // Find the Child item row - must avoid any option in the picker
    const allChildElements = screen.getAllByText("Child");
    const childItemSpan = allChildElements.find((el) => el.tagName !== "OPTION");
    const childRowContainer =
      childItemSpan?.closest("[data-test*='item']") ||
      childItemSpan?.parentElement?.parentElement ||
      childItemSpan?.parentElement;

    // Click edit on child (unconditional - must exist)
    const editBtn = within(childRowContainer!).getByTestId("item-edit-button");
    fireEvent.click(editBtn);

    // Select "top-level" or null option (unconditional - must exist)
    const parentSelect = within(childRowContainer!).getByTestId("item-parent-select");
    fireEvent.change(parentSelect, { target: { value: "null" } });

    // Save (unconditional - must exist)
    const saveBtn = within(childRowContainer!).getByTestId("item-edit-save");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateItemMock).toHaveBeenCalled();
    });

    const call = mockUpdateItemMock.mock.calls[0];
    expect(call[0]).toEqual(71);
    // Verify explicit null is sent, not absent key
    expect(call[1]).toHaveProperty("parent_item_id");
    expect(call[1].parent_item_id).toBeNull();
  });

  it("C7: 4-level fixture, edit picker excludes item, descendants, and other plans' items", async () => {
    // R → Citem → Gitem → Hitem, plus R2, plus plan B with X
    const plan = makePlan({ id: 9, plan: { id: 9, project_id: "proj-c7" } });
    const r = makeItem({ id: 1, text: "R" });
    const citem = makeItem({ id: 2, text: "Citem", parent_item_id: 1 });
    const gitem = makeItem({ id: 3, text: "Gitem", parent_item_id: 2 });
    const hitem = makeItem({ id: 4, text: "Hitem", parent_item_id: 3 });
    const r2 = makeItem({ id: 5, text: "R2" });
    plan.items = [r, citem, gitem, hitem, r2];

    const planB = makePlan({ id: 10, plan: { id: 10, project_id: "proj-c7" } });
    const x = makeItem({ id: 100, text: "X" });
    planB.items = [x];

    mockListMock.mockResolvedValue({
      plans: [plan, planB],
      closedCount: 0,
      latestClosure: null,
    });
    mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
    mockHealthMock.mockResolvedValue(makeHealth());

    render(<PlanLedgerPanel projectId="proj-c7" />);

    await waitFor(() => {
      expect(mockListMock).toHaveBeenCalled();
    });

    // Find the Citem row - must avoid any option in the picker and child items
    const allCitemElements = screen.getAllByText("Citem");
    const citemSpan = allCitemElements.find((el) => el.tagName !== "OPTION");

    // Get the parent row container - walk up through parent elements carefully
    let citemRowContainer = citemSpan?.parentElement;
    while (
      citemRowContainer &&
      !citemRowContainer.getAttribute("data-test")?.includes("item-row")
    ) {
      citemRowContainer = citemRowContainer.parentElement;
    }

    // If we couldn't find it via data-test, try the more direct approach
    if (!citemRowContainer) {
      citemRowContainer = citemSpan?.closest("[data-test='item-row']");
    }

    // Click edit on Citem (must get the edit button within this specific row)
    const editBtn = within(citemRowContainer!).queryAllByTestId("item-edit-button")[0];
    if (!editBtn) throw new Error("Edit button not found for Citem");
    fireEvent.click(editBtn);

    // Get the parent select in edit mode (must get it from within this specific row)
    const parentSelect = within(citemRowContainer!).queryAllByTestId("item-parent-select")[0];
    if (!parentSelect) throw new Error("Parent select not found for Citem");

    // Get all options
    const options = parentSelect.querySelectorAll("option");
    const optionTexts = Array.from(options).map((o) => (o.textContent || "").trim());

    // Verify:
    // - Citem (self) is absent
    // - Gitem (child) is absent
    // - Hitem (grandchild) is absent — THIS IS THE KEY ASSERTION
    // - R (ancestor) is present
    // - R2 (sibling) is present
    // - X (other plan) is absent
    expect(optionTexts).not.toContain("Citem");
    expect(optionTexts).not.toContain("Gitem");
    expect(optionTexts).not.toContain("Hitem"); // Grandchild must be absent
    expect(optionTexts).toContain("R");
    expect(optionTexts).toContain("R2");
    expect(optionTexts).not.toContain("X");
  });
});
