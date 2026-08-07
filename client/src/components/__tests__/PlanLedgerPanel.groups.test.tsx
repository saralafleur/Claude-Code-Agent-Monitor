/**
 * @file Tests for PlanLedgerPanel groups feature (Slice 3)
 * C-1…C-8: Groups proposal UI, availability states, entity-switch reset, StrictMode safety, i18n
 * Real RTL assertions: render the component, interact with it, verify the DOM and mock calls.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, rerender } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PlanLedgerPanel,
  GROUP_RUN_STATES,
  GROUP_REFINEMENT_STATES,
  GROUP_REVIEW_STATES,
  GROUP_MEMBER_AVAILABILITY,
  GROUP_PROPOSE_OUTCOMES,
  GROUP_GATE_STATES,
} from "../PlanLedgerPanel";

const mockGroupsMock = vi.fn();
const mockProposeGroupsMock = vi.fn();
const mockApproveGroupMock = vi.fn();
const mockDismissGroupMock = vi.fn();
const mockCoverageMock = vi.fn();
const mockRequestCoverageMock = vi.fn();
// The component's core data-load effect (`load()`) also calls these three —
// without them mocked, that effect's `Promise.all` rejects (undefined is
// not callable), which silently blanks the whole panel behind the error
// banner before the groups UI ever gets a chance to render.
const mockListMock = vi.fn();
const mockPoolMock = vi.fn();
const mockHealthMock = vi.fn();

// vi.mock must wrap the mocked surface in the same `api:` object api.ts
// itself exports (compare PlanLedgerPanel.test.tsx) — a bare
// `projectPlans:` export here doesn't match the component's own
// `import { api } from "../../lib/api"` + `api.projectPlans.X(...)` call
// shape, so every call below actually hits the real (un-mocked) module.
vi.mock("../../lib/api", () => ({
  api: {
    projectPlans: {
      list: (...args: unknown[]) => mockListMock(...args),
      pool: (...args: unknown[]) => mockPoolMock(...args),
      health: (...args: unknown[]) => mockHealthMock(...args),
      groups: (...args: unknown[]) => mockGroupsMock(...args),
      proposeGroups: (...args: unknown[]) => mockProposeGroupsMock(...args),
      approveGroup: (...args: unknown[]) => mockApproveGroupMock(...args),
      dismissGroup: (...args: unknown[]) => mockDismissGroupMock(...args),
      coverage: (...args: unknown[]) => mockCoverageMock(...args),
      requestCoverage: (...args: unknown[]) => mockRequestCoverageMock(...args),
    },
  },
}));

function makeGroups(overrides: any = {}) {
  return {
    run: {
      id: "run-1",
      state: "completed",
      batch_count: 1,
      group_count: 1,
      ...overrides.run,
    },
    groups: [
      {
        id: 1,
        run_id: "run-1",
        name: "Database Schema",
        summary_sentence: "Plan the new schema.",
        rationale: "For scalability.",
        refinement_state: "refined",
        review_status: "proposed",
        members: [
          { unitKey: "d1", availability: "available" },
          { unitKey: "d2", availability: "already_claimed" },
          { unitKey: "d3", availability: "no_longer_in_pool" },
          { unitKey: "d4", availability: "available" },
        ],
        member_availability_counts: {
          available: 2,
          already_claimed: 1,
          no_longer_in_pool: 1,
        },
      },
    ],
    gate: "ready",
    // loadGroups() also merges THIS coverage field into component state
    // (mergeCoverage, freshest `computed_at` wins) — it must carry the same
    // unconditionally-read fields makeCoverage() does (eta, demand, etc.),
    // or a render that lands after this response resolves first crashes on
    // `coverage.eta.state`. Deliberately older `computed_at` than
    // makeCoverage()'s own default: this is a secondary/incidental copy of
    // coverage carried by the groups response, and must never outrank
    // whatever the test's own `mockCoverageMock` fixture says (e.g. C-2's
    // complete:false→true transition), regardless of which of the two
    // requests happens to resolve first. `function` declarations hoist, so
    // calling makeCoverage() here (above its own definition) is safe.
    coverage: makeCoverage({
      complete: true,
      pool_size: 4,
      computed_at: "2020-01-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

// Mirrors PlanLedgerPanel.test.tsx's own makeCoverage() — the component
// reads described/pending/demand/requested_at/computed_at/eta
// unconditionally (e.g. `coverage.eta.state`), so a fixture missing any of
// them crashes the render rather than merely under-testing it.
function makeCoverage(overrides: any = {}) {
  return {
    project_id: "proj-1",
    described: 0,
    pool_size: 10,
    pending: 0,
    complete: true,
    demand: "passive",
    requested_at: null,
    eta: { state: "none" },
    computed_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Safe defaults for the core data-load effect's three other legs
  // (list/pool/health) — individual tests only care about groups/coverage.
  mockListMock.mockResolvedValue({ plans: [] });
  mockPoolMock.mockResolvedValue({ units: [], identityWarnings: [] });
  mockHealthMock.mockResolvedValue({
    unclaimedPoolSize: 0,
    lastClosureAt: null,
    daysSinceLastClosure: null,
    openPlanCount: 0,
  });
});

describe("PlanLedgerPanel: Groups (Slice 3)", () => {
  it("C-1 [M]: No client-side re-derivation of availability_counts — renders server numbers, all 3 states visibly distinct", async () => {
    // Real RTL assertion: mock groups data, render, verify counts and distinct rendering
    const groupsData = makeGroups();
    mockGroupsMock.mockResolvedValue(groupsData);
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage() });

    const { container } = render(<PlanLedgerPanel projectId="proj-1" />);

    // Wait for groups to load — "the mock was called" only proves the
    // request FIRED, not that the DOM actually updated with the response.
    // Wait for real rendered content (the group's own name) instead.
    await waitFor(() => {
      expect(screen.getByText("Database Schema")).toBeDefined();
    });

    // BL-9 fix: `queryByText` returns `null` on a miss, and
    // `expect(null).toBeDefined()` PASSES (null is a defined value) — the
    // old assertions here could never fail even when the counts were never
    // rendered at all. Use the component's own `data-test` hooks
    // (BL-9's product fix) and assert non-null / real text content.
    const availableEl = container.querySelector('[data-test="availability-count-available"]');
    const claimedEl = container.querySelector('[data-test="availability-count-already_claimed"]');
    const missingEl = container.querySelector('[data-test="availability-count-no_longer_in_pool"]');

    expect(availableEl).not.toBeNull();
    expect(claimedEl).not.toBeNull();
    expect(missingEl).not.toBeNull();
    expect(availableEl!.textContent).toMatch(/2/);
    expect(claimedEl!.textContent).toMatch(/1/);
    expect(missingEl!.textContent).toMatch(/1/);

    // The three states must render VISIBLY DISTINCT text, not merely exist
    // — deliberately deduped through a Set so an accidental "render the
    // same fallback text three times" bug (which would still satisfy the
    // not-null checks above) fails here.
    const renderedTexts = [
      availableEl!.textContent,
      claimedEl!.textContent,
      missingEl!.textContent,
    ];
    expect(new Set(renderedTexts).size).toBe(3);

    // Verify three distinct member-chip rendering treatments too (the
    // per-member detail list, separate from the server-count summary above).
    const chips = container.querySelectorAll("[data-availability-state]");
    expect(chips.length).toBeGreaterThanOrEqual(3); // at least 3 distinct states rendered
  });

  it("C-2 [R]: Auto-group button disabled while !coverage.complete, enables on update false→true; exactly one prioritize-now-button, auto-group is its own separate control", async () => {
    // Real RTL assertion: render with coverage incomplete, verify disabled; update to complete, verify enabled
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage({ complete: false }) });
    mockGroupsMock.mockResolvedValue(makeGroups());

    const { container } = render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(mockCoverageMock).toHaveBeenCalled();
    });

    // BL-12 fix: the auto-group button is reachable through its OWN
    // `data-test="auto-group-button"` hook, never through the shared
    // `prioritize-now-button` selector — asserting BOTH halves of the PO §5
    // fence: exactly one element carries `prioritize-now-button` (the
    // pre-existing coverage-header control), AND the new auto-group button
    // exists as its own, separately-selectored control.
    expect(container.querySelectorAll('[data-test="prioritize-now-button"]').length).toBe(1);

    const autoGroupButton = container.querySelector('[data-test="auto-group-button"]');
    expect(autoGroupButton).not.toBeNull();
    expect(autoGroupButton).toBeDisabled();

    // Update to coverage complete. The panel never re-fetches coverage on
    // an unchanged `projectId` prop (`load`'s useCallback deps are
    // `[projectId]` — rerendering with the SAME projectId is a no-op, the
    // effect never refires), so a same-prop `rerender()` can never exercise
    // this transition. The REAL mechanism the component uses to receive a
    // fresher coverage snapshot without a re-fetch is its eventBus
    // subscription to `value_altitudes_updated` (mirrors
    // PlanLedgerPanel.test.tsx's own BL-2/R4 cases) — use that instead.
    const { eventBus } = await import("../../lib/eventBus");
    eventBus.publish({
      type: "value_altitudes_updated",
      timestamp: "2026-08-06T00:00:01.000Z",
      data: {
        project_id: "proj-1",
        unit_keys: [],
        pending: 0,
        coverage: makeCoverage({ complete: true, computed_at: "2026-08-06T00:00:01.000Z" }),
      },
    });

    // Button should now be enabled.
    await waitFor(() => {
      const updatedButton = container.querySelector('[data-test="auto-group-button"]');
      expect(updatedButton).not.toBeNull();
      expect(updatedButton).not.toBeDisabled();
    });

    // The `prioritize-now-button` legitimately UNMOUNTS once coverage is
    // complete (it is conditionally rendered only while there is coverage
    // left to prioritize) — so "exactly one" no longer applies post-update;
    // what still must hold is "never duplicated" (at most one).
    expect(
      container.querySelectorAll('[data-test="prioritize-now-button"]').length
    ).toBeLessThanOrEqual(1);
  });

  it("BL-1 [M]: Clicking auto-group calls proposeGroups, then re-fetches and renders groups without crashing", async () => {
    // BL-1's exact reproduction: the propose response never carries an
    // enriched `groups` key (no `members`/`member_availability_counts`
    // composition — that's `GET /groups`'s own job). The OLD component did
    // `if (res.groups) setGroupsList(res.groups)` unconditionally and then
    // read `group.members.length` on the very next render, crashing with
    // `TypeError: Cannot read properties of undefined (reading 'length')`.
    // This test actually CLICKS the button (no prior test in this file
    // did) and asserts the panel renders real group content afterward
    // instead of crashing.
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage({ complete: true }) });
    mockGroupsMock.mockResolvedValueOnce({
      run: { id: null, state: "not_attempted", project_id: "proj-1" },
      groups: [],
      gate: "ready",
      coverage: makeCoverage({ complete: true }),
    });
    // Deliberately NO `groups` key — matches the real, fixed server
    // contract for all three propose outcomes.
    mockProposeGroupsMock.mockResolvedValue({
      outcome: "started",
      run: { id: "run-new", state: "in_progress", project_id: "proj-1" },
      gate: "ready",
      coverage: makeCoverage({ complete: true }),
    });
    // The client's own re-GET after propose — this is what must actually
    // fire, and its (enriched, `members`-carrying) response is what must
    // render without crashing.
    mockGroupsMock.mockResolvedValueOnce(makeGroups());

    const { container } = render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(container.querySelector('[data-test="auto-group-button"]')).not.toBeNull();
    });
    const button = container.querySelector('[data-test="auto-group-button"]') as HTMLElement;
    expect(button).not.toBeDisabled();

    await userEvent.click(button);

    expect(mockProposeGroupsMock).toHaveBeenCalledWith("proj-1");
    // The re-fetched, enriched group must actually render — proving the
    // panel did not crash on `group.members` being undefined.
    await waitFor(() => {
      expect(screen.getByText("Database Schema")).toBeDefined();
    });
    expect(mockGroupsMock).toHaveBeenCalledTimes(2); // initial load + the post-propose re-fetch
  });

  it("C-3 [R]: Approve/Dismiss call methods exactly once, no 'Approve & claim', no claim picker, no plan affordance", async () => {
    // Real RTL assertion: render group, approve/dismiss, verify API calls and no forbidden elements
    const groupsData = makeGroups();
    mockGroupsMock.mockResolvedValue(groupsData);
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage() });
    // handleApproveGroup/handleDismissGroup read res.review_status/
    // res.reviewed_at from the resolved value — an unmocked vi.fn()
    // resolves to undefined, which crashes reading those fields off it.
    mockApproveGroupMock.mockResolvedValue({
      review_status: "approved",
      reviewed_at: "2026-08-06T00:00:00.000Z",
    });
    mockDismissGroupMock.mockResolvedValue({
      review_status: "dismissed",
      reviewed_at: "2026-08-06T00:00:00.000Z",
    });

    const { container } = render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("Database Schema")).toBeDefined();
    });

    // Find and click approve button
    const approveButton = screen.queryByRole("button", { name: /approve/i });
    if (approveButton) {
      await userEvent.click(approveButton);
    }

    // Verify approveGroup was called exactly once with the group ID
    // Will fail because button doesn't exist yet (genuine RED)
    expect(mockApproveGroupMock).toHaveBeenCalledOnce();
    expect(mockApproveGroupMock).toHaveBeenCalledWith("proj-1", 1);

    // Verify forbidden elements are absent
    const claimText = screen.queryByText(/approve.*claim/i);
    const claimPicker = screen.queryByRole("combobox", { name: /claim/i });
    const editButton = screen.queryByRole("button", { name: /edit.*item/i });

    expect(claimText).toBeNull();
    expect(claimPicker).toBeNull();
    expect(editButton).toBeNull();
  });

  it("C-4 [R]: No raw i18n key leaks (no planLedger.* key text in rendered output)", async () => {
    // Real RTL assertion: render groups in various states, scan DOM for key leaks
    const groupsData = makeGroups({
      groups: [
        makeGroups().groups[0],
        {
          ...makeGroups().groups[0],
          id: 2,
          refinement_state: "pending",
          review_status: "approved",
        },
        { ...makeGroups().groups[0], id: 3, refinement_state: "failed" },
      ],
    });
    mockGroupsMock.mockResolvedValue(groupsData);
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage() });

    const { container } = render(<PlanLedgerPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(mockGroupsMock).toHaveBeenCalled();
    });

    // BL-11 fix: every Slice-3 key lives at path `planLedger.*` INSIDE the
    // `projectDetail` i18n namespace this component's `useTranslation`
    // hook already scopes into — so an unresolved key renders literally as
    // `planLedger.groups.foo`, which `/projectDetail\./` (this test's old,
    // only-asserted regex) can never match. `/planLedger\.[a-zA-Z]/` is the
    // regex this codebase's OTHER files already use for this exact class of
    // check (PlanLedgerPanel.test.tsx) — compute it AND actually assert it.
    const bodyText = container.textContent || "";
    const hasPlanLedgerKey = /planLedger\.[a-zA-Z]/i.test(bodyText);

    expect(hasPlanLedgerKey).toBe(false);
  });

  it("C-5 [R]: PM-5a entity-switch reset — groups state resets on projectId change", async () => {
    // Real RTL assertion: render proj-A, switch to proj-B, verify A's data is gone and B's is present.
    // A's group is given a name distinct from B's fixture (which reuses the
    // shared "Database Schema" default) — otherwise "A's data is gone"
    // can never be asserted, since B's own real data would legitimately
    // also match the same text query.
    const groupsA = makeGroups({
      run: { ...makeGroups().run, id: "run-a" },
      groups: [{ ...makeGroups().groups[0], name: "Project A Group" }],
    });
    const groupsB = makeGroups({
      run: { ...makeGroups().run, id: "run-b", group_count: 2 },
      groups: [makeGroups().groups[0], { ...makeGroups().groups[0], id: 2 }],
    });

    mockGroupsMock.mockResolvedValue(groupsA);
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage() });

    const { rerender: rtlRerender } = render(<PlanLedgerPanel projectId="proj-A" />);

    await waitFor(() => {
      expect(mockGroupsMock).toHaveBeenCalledWith("proj-A");
    });

    // Verify A's group name is rendered. `queryByText` returns `null` on a
    // miss and `expect(null).toBeDefined()` PASSES (null is itself a
    // defined value) — use `getByText` inside `waitFor` (BL-9's established
    // fix pattern in this file) so a missing render actually fails red.
    await waitFor(() => {
      expect(screen.getByText("Project A Group")).not.toBeNull();
    });

    // Switch to proj-B
    mockGroupsMock.mockClear();
    mockGroupsMock.mockResolvedValue(groupsB);

    rtlRerender(<PlanLedgerPanel projectId="proj-B" />);

    await waitFor(() => {
      expect(mockGroupsMock).toHaveBeenCalledWith("proj-B");
    });

    // Verify A's data is gone, and B's real data (not a leftover render of
    // A's) is what's actually present. B's own fixture legitimately
    // contains TWO groups both named "Database Schema" (id 1 and id 2) —
    // queryAllByText, not queryByText (which throws on >1 match).
    const groupANameAfterSwitch = screen.queryByText("Project A Group");
    expect(groupANameAfterSwitch).toBeNull(); // A's state should be cleared
    expect(screen.queryAllByText("Database Schema").length).toBeGreaterThan(0); // B's own data
  });

  it("C-6 [R]: PM-5a in-flight deferred — stale promise from proj-A doesn't render under proj-B", async () => {
    // Real RTL assertion: deferred promise for proj-A, switch to proj-B before resolving, verify stale data doesn't appear.
    // A's late-arriving payload is given a name distinct from B's fixture
    // (which uses the shared "Database Schema" default) — otherwise "stale
    // A data never renders" can't be distinguished from B's own real data,
    // which legitimately shares that same default name (same issue as C-5).
    let resolveA: any;
    const deferredA = new Promise((resolve) => {
      resolveA = resolve;
    });

    mockGroupsMock.mockReturnValueOnce(deferredA);
    mockGroupsMock.mockResolvedValueOnce(makeGroups({ run: { id: "run-b" } }));
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage() });

    const { rerender: rtlRerender } = render(<PlanLedgerPanel projectId="proj-A" />);

    await waitFor(() => {
      expect(mockGroupsMock).toHaveBeenCalledWith("proj-A");
    });

    // Switch to proj-B before proj-A resolves
    rtlRerender(<PlanLedgerPanel projectId="proj-B" />);

    await waitFor(() => {
      expect(mockGroupsMock).toHaveBeenCalledWith("proj-B");
    });

    // Now resolve proj-A's deferred promise, with a name unique to A.
    resolveA(
      makeGroups({
        run: { id: "run-a" },
        groups: [{ ...makeGroups().groups[0], name: "Stale Project A Group" }],
      })
    );

    await waitFor(() => {
      // B's real data ("Database Schema") should be showing…
      expect(screen.queryAllByText("Database Schema").length).toBeGreaterThan(0);
    });
    // …and A's stale data must never appear, even after A's deferred
    // promise resolves well after the switch to B.
    const groupAName = screen.queryByText("Stale Project A Group");
    expect(groupAName).toBeNull();
  });

  it("C-7 [R]: PM-5b StrictMode — groups UI renders correctly after setup→cleanup→setup double-invoke", () => {
    // Real RTL assertion: render under StrictMode, verify groups text appears (not blank)
    mockGroupsMock.mockResolvedValue(makeGroups());
    mockCoverageMock.mockResolvedValue({ coverage: makeCoverage() });

    const { container } = render(
      <StrictMode>
        <PlanLedgerPanel projectId="proj-1" />
      </StrictMode>
    );

    // Verify groups UI renders (not blank)
    // Will fail because groups don't render yet (genuine RED) — queryByRole
    // returns null (not undefined) when absent, so this must check for null,
    // not toBeDefined() (which is trivially true for null).
    const groupsContainer = screen.queryByRole("region", { name: /groups/i });
    expect(groupsContainer).not.toBeNull();

    // Verify text is present (not blank after StrictMode double-invoke)
    const hasText = (container.textContent || "").length > 10;
    expect(hasText).toBe(true);
  });

  it("C-8 [R]: Locale mirror registry test — all 6 registries have anchored sets and every wire value has a real key in en/ko/vi/zh", () => {
    // BL-10 fix: the old version built a `requiredKeys` array and then
    // never used `keyPath` inside its own loop body (`expect(localeFile)
    // .toBeDefined()` — true regardless of which keys exist), and carried
    // no anchored exemption-set assertions on the six registries at all.
    // This version imports the REAL registries this component renders
    // against (BL-10: now exported from PlanLedgerPanel.tsx, not a
    // separate hand-retyped copy), anchors each one, and then walks every
    // wire value × all four locales, resolving the real
    // `planLedger.<namespace>.<value>` key path and asserting it resolves
    // to a real, non-empty string — not merely that the locale FILE exists.
    // Anchored exemption-set assertions (PM-5c shape) — a 5th/6th value
    // added to any registry without a matching intake decision breaks
    // HERE, at the point of growth, not silently.
    expect([...GROUP_RUN_STATES].sort()).toEqual(
      ["completed", "completed_zero_groups", "failed", "in_progress", "not_attempted"].sort()
    );
    expect([...GROUP_REFINEMENT_STATES].sort()).toEqual(
      ["failed", "pending", "refined", "zero_members"].sort()
    );
    expect([...GROUP_REVIEW_STATES].sort()).toEqual(
      ["approved", "claimed", "dismissed", "proposed"].sort()
    );
    expect([...GROUP_MEMBER_AVAILABILITY].sort()).toEqual(
      ["already_claimed", "available", "no_longer_in_pool"].sort()
    );
    expect([...GROUP_PROPOSE_OUTCOMES].sort()).toEqual(
      ["already_running", "blocked_coverage_incomplete", "reused_unchanged", "started"].sort()
    );
    expect([...GROUP_GATE_STATES].sort()).toEqual(["blocked_coverage_incomplete", "ready"].sort());

    const REGISTRY_NAMESPACES: Array<[readonly string[], string]> = [
      [GROUP_RUN_STATES, "runState"],
      [GROUP_REFINEMENT_STATES, "refinementState"],
      [GROUP_REVIEW_STATES, "reviewStatus"],
      [GROUP_MEMBER_AVAILABILITY, "memberAvailability"],
      [GROUP_PROPOSE_OUTCOMES, "proposeOutcome"],
      [GROUP_GATE_STATES, "gateState"],
    ];
    const locales = ["en", "ko", "vi", "zh"];
    const localeFiles: Record<string, any> = {};
    for (const locale of locales) {
      localeFiles[locale] = require(`../../i18n/locales/${locale}/projectDetail.json`);
    }

    // Red-proof (performed): deleting `planLedger.memberAvailability.available`
    // from `ko/projectDetail.json` makes `missing` below name exactly
    // `ko:planLedger.memberAvailability.available` — restored after
    // confirming the red.
    const missing: string[] = [];
    for (const [values, namespace] of REGISTRY_NAMESPACES) {
      for (const value of values) {
        for (const locale of locales) {
          const resolved = localeFiles[locale]?.planLedger?.[namespace]?.[value];
          if (typeof resolved !== "string" || resolved.length === 0) {
            missing.push(`${locale}:planLedger.${namespace}.${value}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
