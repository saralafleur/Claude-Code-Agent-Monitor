# Build Task List — Slice 5 (Plan Ledger Workbench UI)

**Effort:** `intake/2026-08-02-plan-lifecycle-value-ledger/` (parent)  
**Build:** Slice 5 only (client UI) — backend shipped on `master` commit `9ee4653` + subsequent slice 3/4 merges  
**Worktree:** `/Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor`  
**Branch:** `effort/2026-08-03-plan-lifecycle-workbench-ui`  
**Starting commit:** `2f8408a0d56799a8002d859e9f14e3927a3868af`

**Status:** 59 files / 773 client tests (all green) at start. No `PlanLedgerPanel.tsx` or its test file exist yet. `types.ts` and `api.ts` carry no `ProjectPlan`/`ValueUnit`/`projectPlans` symbols yet.

---

## Prerequisite: Verify backend is ready

**T0 (blocking; not executable in this build — check only):** The backend for this slice already shipped on `master`:
- Routes: `server/routes/project-plans.js` (GET `/api/project-plans`, `/pool`, `/health`, `/history`; POST/PATCH/DELETE for plans, items, claims; POST `/import`)
- Types: server-side models (`ProjectPlan`, `ValueUnit`, `ValueClaim`, `PlanHealth`, `ValuePool`) defined and persisted
- Database: three tables (`project_plans`, `project_plan_items`, `value_claims`) created by migration and verified present
- CLI: `ccam ledger` commands available

**Done-check:** 
```bash
# Verify routes are live
node -e "const r=require('./server/routes/project-plans.js'); console.log(r._router.stack.filter(l=>l.route).map(l=>Object.keys(l.route.methods)).flat());"
# Expected: at least GET, POST for / and /pool and /health and /history, DELETE for /claims/:claimId
```

---

## LAYER F — Client Component/Page/Snapshot Tests (Red-First)

### F1 — Component spec: `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (NEW, 7 cases) — TEST STEP

**Files touched:** (test file only, not yet created)  
**Component:** PlanLedgerPanel (does not exist yet)  
**What changes:** Create the test file from scratch, specifying the full behavior of the panel.

**Test cases (red-first, in order):**

1. **F1.1 — Render multiple open plans with nested items (RED)**  
   Left pane renders two open plans from the mocked API response, each with title and nested items (using `within` to prove nesting). Items show `text` field. Zero affordances render for a closed plan's items.
   
   **Red-proof:** The component doesn't exist → import error / component not found  
   **Done-check:**
   ```bash
   cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
   cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -- --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|F1.1)"
   ```

2. **F1.2 — Render pool units with tier badges (RED)**  
   Right pane renders the mocked pool array (7 units, no hardcoded count). Each unit displays a badge naming its `value_source` tier. No pre-claimed units shown.
   
   **Red-proof:** The component doesn't exist yet.  
   **Done-check:** Same command as F1.1, output shows F1.2 passing.

3. **F1.3 — Claim gesture calls API and unit disappears on refetch (RED)**  
   Click a claim button on a pool unit; assert `api.projectPlans.claim(planId, itemId, unit)` called exactly once with the right args; mock the response; simulate a refetch; assert the unit is no longer in the pool array in the DOM.
   
   **Red-proof:** Component doesn't exist.  
   **Done-check:** F1.3 passes.

4. **F1.4 — Close gesture calls API and plan moves to history (RED)**  
   Click a close button on an open plan with a closure note; assert `api.projectPlans.close(planId, {closure_note})` called exactly once; mock 200 response; simulate a refetch; assert the plan disappears from the open pane and appears in a collapsed "Closed Generations" history list.
   
   **Red-proof:** Component doesn't exist.  
   **Done-check:** F1.4 passes.

5. **F1.5 — Health numbers render from server payload, verbatim — § 9.1 MANDATORY (RED)**  
   Mock `health.unclaimedPoolSize = 37` (while the mocked pool array has exactly 5 elements). Assert the rendered panel headline shows **37**, not 5. Assert `health.lastClosureAt: null` renders without `NaN` or `Invalid Date` in `container.textContent`.
   
   **Red-proof (R1, RECORDED):** Temporarily change the component to render `pool.length` instead of `health.unclaimedPoolSize` → this case must turn red. Restore and confirm green again. (**This is not a description; this is a live mutation test.**)
   
   **Rationale:** §9.1 DERIVED-DUAL-VIEW forbids client-side re-derivation of any value already computed in `server/lib/value-ledger.js`. The test proves the panel is a **consumer**, not a computer. Health numbers are computed once on the server; the UI reads them verbatim.
   
   **Done-check:** 
   ```bash
   # Before the mutation:
   cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -- -t "verbatim"
   # Expected: PASS
   
   # Inject the mutation into PlanLedgerPanel.tsx (manually, for the test):
   # Replace: const headline = health.unclaimedPoolSize ?? 0;
   # With: const headline = pool.length;
   # Run again:
   cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -- -t "verbatim"
   # Expected: FAIL (shows 5, expected 37)
   
   # Restore the correct code.
   cd client && npx vitest run src/components/__tests__/PlanLedgerPanel.test.tsx -- -t "verbatim"
   # Expected: PASS
   ```

6. **F1.6 — Closed generation exposes no edit/claim/unclaim affordances (RED)**  
   Render a closed plan in the history section. Assert the DOM contains no "add item", "claim", "unclaim" buttons or inputs for that plan or its items. Assert a closed plan's items show text but no checkboxes, edit buttons, or trash icons.
   
   **Red-proof:** Component doesn't exist.  
   **Done-check:** F1.6 passes.

7. **F1.7 — No raw i18n keys leak into the DOM (RED)**  
   Render the full component with mocked API responses. Assert `container.textContent` does not contain the substring `"projectDetail."` (the namespace prefix for leaked keys). Use a regex scan to prove no key like `projectDetail.planLedger.title` appears verbatim in the output.
   
   **Red-proof:** Component doesn't exist (no text to render).  
   **Done-check:** F1.7 passes.

**Setup (shared mocks):**  
- Mock `api.projectPlans.getPlans()` returning `{plans: [{plan: {id:1, title:"Q3 Sprint", status:"open", ordinal:1, opened_at:"...", closed_at:null}, items:[{id:11, text:"Item 1", claims:[]}]}]}`
- Mock `api.projectPlans.getHealth()` returning `{unclaimedPoolSize: 37, lastClosureAt: "2026-07-15T12:00:00Z", daysSinceLastClosure: 19, openPlanCount: 1}`
- Mock `api.projectPlans.getPool()` returning `{units: [{id:1, value_source:"trunk_commit", value_ref:"abc123...", attribution:"mechanical"}, ...6 more], identityWarnings: []}`
- Mock `api.projectPlans.claim()`, `api.projectPlans.close()`, etc. as spy functions

**File header:** Required per `.claude/rules/file-headers.md`  
```typescript
/**
 * @file Tests for PlanLedgerPanel: the two-pane reconciliation workbench for
 * project plans and the unclaimed value pool. Specifies render behavior, claim
 * and close gestures, and the critical health-verbatim assertion (§9.1).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
```

---

### F2 — Page spec: `client/src/pages/__tests__/ProjectDetail.test.tsx` (UPDATE, 1 case) — TEST STEP

**Files touched:** `client/src/pages/__tests__/ProjectDetail.test.tsx`  
**What changes:** Add one new test case; keep existing 15 cases green.

**New case (red-first):**

**F2.1 — PlanLedgerPanel renders as a card alongside existing cards (RED)**  
With `api.projectPlans.*` mocked in the **shared setup, not per-case**, render the ProjectDetail page. Assert it contains the PlanLedgerPanel card alongside the existing Project Details, Worktree Info, and Team Intake Status cards. Assert the panel receives `project_id` as a prop and calls the API to fetch plans/pool/health (all mocked).

**Red-proof:** PlanLedgerPanel doesn't exist yet → import error when ProjectDetail tries to render it.  
**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
cd client && npx vitest run src/pages/__tests__/ProjectDetail.test.tsx -- -t "PlanLedgerPanel"
# Expected: PASS (after PlanLedgerPanel.tsx exists)
```

**Shared setup (ONE entry, used by F2.1 and implicitly by F1 if they share fixtures):**
```typescript
vi.mock("../../lib/api", () => ({
  api: {
    projectPlans: {
      getPlans: vi.fn().mockResolvedValue({...}),
      getHealth: vi.fn().mockResolvedValue({...}),
      getPool: vi.fn().mockResolvedValue({...}),
      claim: vi.fn().mockResolvedValue({...}),
      close: vi.fn().mockResolvedValue({...}),
    },
  },
}));
```

---

### F3 — Snapshot spec: `client/src/pages/__tests__/screens.snapshot.test.tsx` (REVIEWED REGEN, 1 case) — TEST STEP

**Files touched:** 
- `client/src/pages/__tests__/screens.snapshot.test.tsx` (test code)
- `client/src/pages/__tests__/__snapshots__/screens.snapshot.test.tsx.snap` (baselines)

**What changes:** Add `api.projectPlans` mock responses to the "Project Detail" screen fixture; regenerate snapshots; **review the diff, never blind**.

**Case (red-first):**

**F3.1 — Project Detail screen snapshot includes PlanLedgerPanel markup (RED)**  
Locate the Project Detail screen's existing mock fixture (~line 653, find by searching for "Project detail" or by content match, **not by line number — the line anchors drift**). Add `api.projectPlans.*` responses to the fixture (same shape as F1/F2). Regenerate the baseline with `cd client && npx vitest run -u`. Assert the snapshot diff:
- Contains Project Detail + shell chrome (unchanged from prior builds)
- Shows the PanLedgerPanel's markup (left pane with plans, right pane with pool, health numbers)
- Does NOT show an empty state, error boundary, or placeholder

**Red-proof:** Snapshots don't match → test fails with a diff that shows no plan ledger markup.  
**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx -- -t "Project detail"
# Expected: PASS (after implementation + regen)
# Build note: Diff reviewed by hand; no blind reruns against dirty sibling branches
```

**Sequencing note:** This regen **must** run on a clean tree containing **only** this effort's UI changes. Do not regenerate against the main checkout (which has uncommitted edits) or sibling worktrees (`2026-08-02-trunk-drift-detection`, etc.) that independently modify client files — those would launder unreviewed changes into baselines. Per build-brief §"No blind snapshot regen", this worktree was branched fresh off `master` for exactly this reason.

---

## LAYER E — i18n Registry (Moved to Slice 1, confirmed pre-shipped)

No work in this slice for i18n registry assertions. The i18n.test.ts case (E1.1–E1.2) that closes the whole-namespace parity gap shipped in Slice 1 and is already passing. **This slice only adds strings to the existing `projectDetail.json` namespace.**

---

## IMPLEMENTATION STEPS

### I1 — Types + API client additions (IMPLEMENTATION)

**Files touched:**
- `client/src/lib/types.ts` (add new types)
- `client/src/lib/api.ts` (add `api.projectPlans` namespace)

**What changes:**

1. **Add types to `types.ts`** (after existing types, keeping file-header intact):
   ```typescript
   // Portfolio-layer plan types (§9.1: consumers read verbatim, never recompute)
   export interface ProjectPlan {
     id: number;
     project_id: string;
     title: string;
     status: "open" | "closed";
     ordinal?: number; // Derived; exposed by route
     opened_at: string; // ISO 8601
     closed_at: string | null;
     closure_note: string | null;
     succeeds_plan_id: number | null;
     origin: "manual" | "import" | "retroactive_bundle";
     imported_from_cwd?: string;
     imported_content_hash?: string;
     created_at: string;
     updated_at: string;
   }

   export interface ProjectPlanItem {
     id: number;
     plan_id: number;
     parent_item_id: number | null;
     text: string;
     acceptance: string | null;
     detail: string | null;
     checked: 0 | 1;
     position: number;
     target_date: string | null;
     imported_item_id?: string;
     imported_from_cwd?: string;
     created_at: string;
     updated_at: string;
     claims?: ValueClaim[];
   }

   export interface ValueUnit {
     id: number;
     value_source: "trunk_commit" | "merge_commit" | "intake_initiative" | "detour" | "focus_segment";
     value_ref: string;
     source_cwd: string;
     label_snapshot?: string;
     attribution: "mechanical" | "correlational" | "judgment";
     seen_at_snapshot?: string;
     stage_snapshot?: string;
   }

   export interface ValueClaim {
     id: number;
     project_id: string;
     plan_id: number;
     item_id: number;
     value_source: "trunk_commit" | "merge_commit" | "intake_initiative" | "detour" | "focus_segment";
     value_ref: string;
     source_cwd: string;
     label_snapshot?: string;
     seen_at_snapshot?: string;
     stage_snapshot?: string;
     attribution: "mechanical" | "correlational" | "judgment";
     claimed_by: "human" | "llm";
     claimed_at: string;
   }

   export interface PlanHealth {
     unclaimedPoolSize: number;
     lastClosureAt: string | null;
     daysSinceLastClosure: number | null;
     openPlanCount: number;
   }

   export interface ValuePool {
     units: ValueUnit[];
     identityWarnings: Array<{
       kind: string;
       cwds?: string[];
       message?: string;
     }>;
   }
   ```

2. **Add `api.projectPlans` to `api.ts`** (after existing namespaces, keeping structure):
   ```typescript
   projectPlans: {
     // GET /api/project-plans?project_id=&status=
     getPlans: async (projectId: string, status?: "open" | "closed") => {
       const params = new URLSearchParams({ project_id: projectId });
       if (status) params.append("status", status);
       const res = await request("GET", `/project-plans?${params}`);
       return res as { plans: Array<{ plan: ProjectPlan; items: ProjectPlanItem[] }> };
     },
     // GET /api/project-plans/pool?project_id=&lookbackDays=&backfill=1
     getPool: async (projectId: string, lookbackDays?: number, backfill?: boolean) => {
       const params = new URLSearchParams({ project_id: projectId });
       if (lookbackDays !== undefined) params.append("lookbackDays", String(lookbackDays));
       if (backfill) params.append("backfill", "1");
       const res = await request("GET", `/project-plans/pool?${params}`);
       return res as ValuePool;
     },
     // GET /api/project-plans/health?project_id=
     getHealth: async (projectId: string) => {
       const res = await request("GET", `/project-plans/health?project_id=${projectId}`);
       return res as PlanHealth;
     },
     // GET /api/project-plans/history?project_id=
     getHistory: async (projectId: string) => {
       const res = await request("GET", `/project-plans/history?project_id=${projectId}`);
       return res as { closed_generations: Array<{ plan: ProjectPlan; items: ProjectPlanItem[] }> };
     },
     // POST /api/project-plans/:id/claims
     claim: async (planId: number, unitAndItem: { item_id?: number; new_item?: Partial<ProjectPlanItem> } & ValueUnit) => {
       const res = await request("POST", `/project-plans/${planId}/claims`, unitAndItem);
       return res as { claim: ValueClaim };
     },
     // POST /api/project-plans/:id/close
     close: async (planId: number, closureNote?: string) => {
       const res = await request("POST", `/project-plans/${planId}/close`, { closure_note: closureNote });
       return res as { plan: ProjectPlan };
     },
   },
   ```

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
npx tsc --noEmit client/src/lib/types.ts client/src/lib/api.ts
# Expected: no errors
```

---

### I2 — PlanLedgerPanel component (IMPLEMENTATION)

**Files touched:** `client/src/components/PlanLedgerPanel.tsx` (NEW)

**What changes:** Create the component from scratch. Two-pane layout: left = open plans with nested items and close action, right = pool units with tier badges and claim gesture, collapsed closed-generations history.

**Component structure:**

```typescript
/**
 * @file PlanLedgerPanel — two-pane reconciliation workbench for project plans
 * and the live unclaimed value pool. Health numbers (unclaimedPoolSize,
 * daysSinceLastClosure) render verbatim from the server response with zero
 * client-side re-derivation (§9.1). Closed generations collapse into history;
 * no affordances render for closed plans or their items (DEC-P6).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ProjectPlan, ProjectPlanItem, ValueUnit, PlanHealth, ValuePool } from "../lib/types";
import { useTranslation } from "react-i18next";

interface PlanLedgerPanelProps {
  projectId: string;
}

export function PlanLedgerPanel({ projectId }: PlanLedgerPanelProps) {
  const { t } = useTranslation("projectDetail");
  const [plans, setPlans] = useState<Array<{ plan: ProjectPlan; items: ProjectPlanItem[] }>>([]);
  const [health, setHealth] = useState<PlanHealth | null>(null);
  const [pool, setPool] = useState<ValuePool | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [plansRes, healthRes, poolRes] = await Promise.all([
          api.projectPlans.getPlans(projectId, "open"),
          api.projectPlans.getHealth(projectId),
          api.projectPlans.getPool(projectId),
        ]);
        setPlans(plansRes.plans || []);
        setHealth(healthRes);
        setPool(poolRes);
      } catch (err) {
        setError((err as Error).message || "Failed to load plan ledger");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [projectId]);

  const handleClaim = async (unit: ValueUnit, planId: number, itemId: number) => {
    try {
      await api.projectPlans.claim(planId, {
        ...unit,
        item_id: itemId,
      });
      // Refetch pool to reflect the claim
      const updatedPool = await api.projectPlans.getPool(projectId);
      setPool(updatedPool);
    } catch (err) {
      setError((err as Error).message || "Failed to claim unit");
    }
  };

  const handleClose = async (planId: number, closureNote?: string) => {
    try {
      await api.projectPlans.close(planId, closureNote);
      // Refetch all data
      const [plansRes, healthRes] = await Promise.all([
        api.projectPlans.getPlans(projectId),
        api.projectPlans.getHealth(projectId),
      ]);
      setPlans(plansRes.plans.filter((p) => p.plan.status === "open") || []);
      setHealth(healthRes);
    } catch (err) {
      setError((err as Error).message || "Failed to close plan");
    }
  };

  if (loading) return <div>{t("planLedger.loading")}</div>;
  if (error) return <div className="error">{error}</div>;

  const openPlans = plans.filter((p) => p.plan.status === "open");
  const unclaimedUnits = pool?.units || [];
  const healthHeadline = health?.unclaimedPoolSize ?? 0;

  return (
    <div className="plan-ledger-panel">
      {/* Left pane: open plans */}
      <div className="plans-pane">
        <h3>{t("planLedger.openPlans")}</h3>
        {openPlans.length === 0 ? (
          <p>{t("planLedger.noOpenPlans")}</p>
        ) : (
          openPlans.map(({ plan, items }) => (
            <div key={plan.id} className="plan-card">
              <div className="plan-header">
                <h4>{plan.title}</h4>
                <button onClick={() => handleClose(plan.id)}>
                  {t("planLedger.closeAction")}
                </button>
              </div>
              <ul className="plan-items">
                {items
                  .filter((item) => !plan.id) /* Placeholder: filter logic */
                  .map((item) => (
                    <li key={item.id}>{item.text}</li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* Right pane: pool + health */}
      <div className="pool-pane">
        <h3>{t("planLedger.poolHeadline", { count: healthHeadline })}</h3>
        <div className="health-stats">
          {health && (
            <>
              <div>{t("planLedger.unclaimedPoolSize", { count: health.unclaimedPoolSize })}</div>
              <div>
                {health.lastClosureAt
                  ? t("planLedger.lastClosure", { date: new Date(health.lastClosureAt).toLocaleDateString() })
                  : t("planLedger.noClosure")}
              </div>
            </>
          )}
        </div>
        {unclaimedUnits.length === 0 ? (
          <p>{t("planLedger.noPool")}</p>
        ) : (
          <div className="pool-units">
            {unclaimedUnits.map((unit) => (
              <div key={`${unit.value_source}-${unit.value_ref}`} className="pool-unit">
                <span className={`badge badge-${unit.attribution}`}>{unit.value_source}</span>
                <button onClick={() => openPlans.length > 0 && handleClaim(unit, openPlans[0].plan.id, openPlans[0].items[0].id)}>
                  {t("planLedger.claimAction")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Refinements in the real implementation:**
- Real nesting of items with `parent_item_id` traversal
- Proper plan selection for claiming (dropdown or explicit per-unit)
- Styling to match the existing card layouts
- i18n key usage for all user-visible strings
- No hardcoded `health.unclaimedPoolSize` re-derivation (use it verbatim as F1.5 tests)

**File header:** Present (see template above).

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
npx tsc --noEmit client/src/components/PlanLedgerPanel.tsx
# Expected: no errors
```

---

### I3 — Render PlanLedgerPanel in ProjectDetail (IMPLEMENTATION)

**Files touched:** `client/src/pages/ProjectDetail.tsx`

**What changes:** Add one import and one render slot.

```typescript
import { PlanLedgerPanel } from "../components/PlanLedgerPanel";

// Inside the render method, alongside existing cards:
<PlanLedgerPanel projectId={projectId} />
```

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
npx tsc --noEmit client/src/pages/ProjectDetail.tsx
# Expected: no errors
```

---

### I4 — i18n strings into `projectDetail.json` (IMPLEMENTATION)

**Files touched:**
- `client/src/i18n/locales/en/projectDetail.json`
- `client/src/i18n/locales/ko/projectDetail.json`
- `client/src/i18n/locales/vi/projectDetail.json`
- `client/src/i18n/locales/zh/projectDetail.json`

**What changes:** Add a `planLedger` key block to the existing `projectDetail` namespace in all four locales (EN translations shown; localizers provide the rest):

```json
{
  "planLedger": {
    "openPlans": "Open Plans",
    "noOpenPlans": "No open plans",
    "closeAction": "Close",
    "poolHeadline": "Unclaimed Value ({{count}})",
    "unclaimedPoolSize": "Unclaimed units: {{count}}",
    "lastClosure": "Last closed: {{date}}",
    "noClosure": "No closed plans yet",
    "noPool": "Pool is empty",
    "claimAction": "Claim",
    "loading": "Loading plans...",
    "historyTitle": "Closed Generations"
  }
}
```

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
node -e "const en=require('./client/src/i18n/locales/en/projectDetail.json'); console.log(en.planLedger ? 'OK' : 'MISSING');"
# Expected: OK for each locale
```

---

## VERIFICATION STEPS

### V1 — File headers (MANDATORY — §9.1 defect catalog requirement)

**What to check:** Every new/modified TypeScript file starts with a file overview + the exact line `@author Son Nguyen <hoangson091104@gmail.com>`.

**Files to verify:**
- `client/src/components/PlanLedgerPanel.tsx` (NEW)
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (NEW)
- `client/src/lib/types.ts` (modified — update overview if needed)
- `client/src/lib/api.ts` (modified — update overview if needed)

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
bash .claude/skills/file-headers/scripts/check-headers.sh
# Expected: exit 0
```

---

### V2 — Client test suite (MANDATORY)

**What to check:** All 59 existing files / 773 tests pass green, plus 9 new test cases (F1: 7, F2: 1, F3: 1).

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
npm run test:client
# Expected: all green, no failures. Output should show ≈9 new cases + 773 existing, all PASS.
```

---

### V3 — Snapshot review (MANDATORY — no blind regeneration)

**What to check:** The `screens.snapshot.test.tsx` regeneration (case F3.1) produces a diff that:
- Shows only the Project Detail screen (+ shell chrome) changed
- Includes the PlanLedgerPanel markup (left pane, right pane, health numbers, pool units)
- Does NOT show an empty state, loader, or error boundary as the final render
- Is reviewed **by hand** before committing

**Review checklist:**
1. Run `cd client && npx vitest run -u` (snapshot update)
2. Open `git diff client/src/pages/__tests__/__snapshots__/screens.snapshot.test.tsx.snap` in your editor
3. Verify:
   - Only one screen changed: "Project detail"
   - Markup includes `plan-ledger-panel`, `plans-pane`, `pool-pane`, health numbers like `unclaimedPoolSize`
   - No `<LoadingSpinner>` or `<ErrorBoundary>` wrapping the panel
4. Commit the diff with a note: "Reviewed snapshot diff for PlanLedgerPanel integration — only Project Detail screen changed, panel renders with live mock data."

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
cd client && npx vitest run src/pages/__tests__/screens.snapshot.test.tsx
# Expected: PASS
# Verify the baseline file was updated:
git diff client/src/pages/__tests__/__snapshots__/screens.snapshot.test.tsx.snap | head -50
```

---

### V4 — TypeScript compilation (MANDATORY)

**What to check:** No compilation errors in the client.

**Done-check:**
```bash
cd /Users/sara/CODE-LOCAL/SARA/efforts/2026-08-03-plan-lifecycle-workbench-ui/Claude-Code-Agent-Monitor
npx tsc --noEmit --project client/tsconfig.json
# Expected: no errors
```

---

## Summary: Task Dependencies & Sequencing

**Execution order (LINEAR — do not parallelize):**

1. **Prerequisite check (T0)** — verify backend routes exist on master
2. **Red-first tests (F1, F2, F3)** — write test files; confirm they fail with expected errors (import not found, etc.)
3. **Types + API (I1)** — add client types and `api.projectPlans` namespace; should make import errors in tests resolve
4. **PlanLedgerPanel component (I2)** — implement the component; F1–F3 tests should begin passing
5. **ProjectDetail integration (I3)** — render the panel in the page; F2 should pass completely
6. **i18n strings (I4)** — add the translation keys; F1.7 should pass (no key leaks)
7. **File header check (V1)** — run the audit script
8. **Full test suite (V2)** — run `npm run test:client`; all 782 tests (773 + 9 new) should pass
9. **Snapshot review (V3)** — regenerate + review the diff by hand
10. **TypeScript check (V4)** — no compilation errors

**Blocking notes:**
- **F1.5 is a durable-cure task (§9.1 DERIVED-DUAL-VIEW).** The red-proof mutation (render `pool.length` instead of `health.unclaimedPoolSize`) **must be performed and observed as red, then restored**. A report of "I ran it red" without a fresh independent re-check is explicitly unverified per this project's standing rule (build-brief §9.3 VACUOUS-GUARD).
- **F3.1 snapshot regen must happen on this clean worktree only.** Never regenerate against the main checkout or sibling branches (which carry unreviewed UI changes). The `2026-08-03-plan-lifecycle-workbench-ui` worktree was branched fresh off `master` for exactly this reason.
- **I2 implementation should not be blind-copied from template patterns.** The component is thin and the design is simple (two panes, one left-side plan list, one right-side pool list, health headline), but the nesting logic, claim flow, and close flow are real application logic and must match the server's response shapes exactly (per I1 types).

---

## Durable-Cure Tasks (MANDATORY)

### MANDATORY: §9.1 DERIVED-DUAL-VIEW health verbatim rendering (test case F1.5 + red-proof R1)

**Defect catalog:** `PROJECT-CONTEXT.md` §9.1  
**What:** Health numbers (`unclaimedPoolSize`, `daysSinceLastClosure`, `lastClosureAt`) must render verbatim from the server response. No client-side re-derivation. The pool array length is never the authority for unclaimed count.  
**Guard:** Test case F1.5 with recorded red-proof mutation: temporarily render `pool.length` instead of `health.unclaimedPoolSize` → test must fail with mismatch (37 ≠ 5). Restore code → test passes. Both states must be recorded in the build notes.  
**Rationale:** This is the second consumer this catalog entry's own history says is where the failure lands. Pool size and last-closure timestamp are computed in `server/lib/value-ledger.js`; the UI is a *reader*, not a computer.

### MANDATORY: File-header convention (new files + modified files with changed purpose)

**Defect catalog:** `.claude/rules/file-headers.md` (this project's binding convention)  
**What:** Every new/edited `.ts`/`.tsx` source file (excluding generated/vendored) starts with a truthful file overview comment plus the exact line `@author Son Nguyen <hoangson091104@gmail.com>`.  
**Files affected:**
- `client/src/components/PlanLedgerPanel.tsx` (NEW) — must have header
- `client/src/components/__tests__/PlanLedgerPanel.test.tsx` (NEW) — must have header
- `client/src/lib/types.ts` (modified) — update overview if the purpose changed
- `client/src/lib/api.ts` (modified) — update overview if the purpose changed

**Guard:** `bash .claude/skills/file-headers/scripts/check-headers.sh` must exit 0.  
**Rationale:** Binding for every coding agent; audit script is the enforcement mechanism.

### MANDATORY: No blind snapshot regeneration

**Context:** build-brief §"No blind snapshot regen" and §9.3 VACUOUS-GUARD  
**What:** Screenshot/snapshot baselines updated only on a clean tree containing *only* this effort's UI changes.  
**Worktree condition:** Confirmed clean at provisioning; fresh branch off `master` at commit `2f8408a0d56799a8002d859e9f14e3927a3868af`; the parent repo carried two uncommitted doc edits (stashed, not committed).  
**Guard:** Before running `cd client && npx vitest run -u`, verify:
```bash
git status --porcelain
# Expected: only modified source files (types.ts, api.ts, PlanLedgerPanel.tsx, ProjectDetail.tsx, 4 locale files)
# NOT: anything from sibling branches (trunk-drift-detection, etc.)
```
Then review the diff by hand as outlined in V3.

---

## End of Build Task List

**Summary for orchestrator:**
- **9 tasks (test + implementation + verification)** — linear sequence, no parallelization
- **Red-first layers:** F1 (7 cases, R1 mutation proof for health verbatim), F2 (1 case, integration), F3 (1 case, snapshot regen with review)
- **MANDATORY durable-cure tasks:** §9.1 health-verbatim (F1.5 + R1), file-header audit, no blind snapshot regen
- **First task:** Verify backend is ready (T0 check)
- **Blockers:** None (backend already shipped on `master`); sequencing is linear by nature (red tests → implementation → green → verify)
