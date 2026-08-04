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

describe("PlanLedgerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no altitude for any unit (LLM off/unavailable) — tests that
    // care about the resolved/generating states override this explicitly.
    mockAltitudesMock.mockResolvedValue({ altitudes: {} });
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
    const plan1Section = (screen
      .getByText("Phase 1: Intake")
      .closest("[data-test='plan-section']") ||
      screen.getByText("Phase 1: Intake").closest("div")) as HTMLElement;
    expect(within(plan1Section).getByText("Item 1")).toBeInTheDocument();
    expect(within(plan1Section).getByText("Item 2")).toBeInTheDocument();
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

    // Find the claim button or unit card and click it
    const claimButton =
      screen.getByRole("button", { name: /claim|add/i }) ||
      screen.getByText(/trunk_commit|Trunk/i).closest("button");
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
});
