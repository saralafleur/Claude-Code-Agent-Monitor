/**
 * @file Supplementary OpenAPI 3.0 fragment for the portfolio-layer plan
 * lifecycle + value ledger (`/api/project-plans`). A deliberately SEPARATE
 * namespace from `server/openapi-extra/plans.js`'s legacy `/api/plans`
 * fragment (R1 — the two plan surfaces never blend). `operationId`s are
 * namespaced `*Portfolio*` / `*Ledger*` / `*ValueClaim*` per QDEC-8 so they
 * never collide with the legacy fragment's `getProjectPlans`
 * (`/api/plans/project/{projectId}`) — that id is shipped contract and is
 * NOT renamed here. Exports `{ tags, schemas, paths }` for merging into the
 * base spec by `createOpenApiSpec()` via server/openapi-extra.js.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const tags = [
  {
    name: "Portfolio Plans",
    description:
      "Portfolio-layer plan lifecycle + value ledger: closable generations of plans keyed by project_id, a live-derived value pool, and the value_claims audit trail. Separate from the legacy cwd-keyed /api/plans mirror.",
  },
];

const errorRef = { $ref: "#/components/schemas/ErrorResponse" };

const schemas = {
  PortfolioPlan: {
    type: "object",
    description: "One generation of a project's portfolio-layer plan.",
    properties: {
      id: { type: "integer" },
      project_id: { type: "string" },
      title: { type: "string" },
      status: { type: "string", enum: ["open", "closed"] },
      succeeds_plan_id: { type: "integer", nullable: true },
      origin: { type: "string", enum: ["manual", "import", "retroactive_bundle"] },
      opened_at: { type: "string" },
      closed_at: { type: "string", nullable: true },
      closure_note: { type: "string", nullable: true },
      imported_from_cwd: { type: "string", nullable: true },
      imported_content_hash: { type: "string", nullable: true },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
  },
  PortfolioPlanItem: {
    type: "object",
    properties: {
      id: { type: "integer" },
      plan_id: { type: "integer" },
      parent_item_id: { type: "integer", nullable: true },
      text: { type: "string" },
      acceptance: { type: "string", nullable: true },
      detail: { type: "string", nullable: true },
      checked: { type: "integer" },
      position: { type: "integer" },
      target_date: { type: "string", nullable: true },
      imported_item_id: { type: "string", nullable: true },
      imported_from_cwd: { type: "string", nullable: true },
      claims: { type: "array", items: { $ref: "#/components/schemas/ValueClaim" } },
    },
  },
  PortfolioPlanWithItems: {
    type: "object",
    properties: {
      plan: { $ref: "#/components/schemas/PortfolioPlan" },
      items: { type: "array", items: { $ref: "#/components/schemas/PortfolioPlanItem" } },
    },
  },
  ValueClaim: {
    type: "object",
    description:
      "The only persisted judgment in this feature. No closed_at column — closure is derived by joining plan_id -> project_plans.status.",
    properties: {
      id: { type: "integer" },
      project_id: { type: "string" },
      plan_id: { type: "integer" },
      item_id: { type: "integer" },
      value_source: {
        type: "string",
        enum: ["trunk_commit", "merge_commit", "intake_initiative", "detour", "focus_segment"],
      },
      value_ref: { type: "string" },
      source_cwd: { type: "string" },
      label_snapshot: { type: "string", nullable: true },
      seen_at_snapshot: { type: "string", nullable: true },
      stage_snapshot: { type: "string", nullable: true },
      attribution: { type: "string", enum: ["mechanical", "correlational", "judgment"] },
      claimed_by: { type: "string", enum: ["human", "llm"] },
      claimed_at: { type: "string" },
    },
  },
  ValueUnit: {
    type: "object",
    description: "One unclaimed value unit surfaced by the live pool assembly.",
    properties: {
      value_source: {
        type: "string",
        enum: ["trunk_commit", "merge_commit", "intake_initiative", "detour", "focus_segment"],
      },
      value_ref: { type: "string" },
      source_cwd: { type: "string" },
      attribution: { type: "string", enum: ["mechanical", "correlational", "judgment"] },
      label: { type: "string", nullable: true },
      unitKey: { type: "string" },
    },
  },
  ValuePool: {
    type: "object",
    properties: {
      units: { type: "array", items: { $ref: "#/components/schemas/ValueUnit" } },
      identityWarnings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["case_variant_duplicate", "no_git_repo", "repo_root_unmapped"],
            },
            cwds: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
  LedgerHealth: {
    type: "object",
    description:
      "computePlanHealth's exact shape — the T6 parity target every consumer reads verbatim.",
    properties: {
      unclaimedPoolSize: { type: "integer" },
      lastClosureAt: { type: "string", nullable: true },
      daysSinceLastClosure: { type: "integer", nullable: true },
      openPlanCount: { type: "integer" },
    },
  },
  LedgerHistory: {
    type: "object",
    description: "AC-6 whole-life summary: closed generations and their claims, no archaeology.",
    properties: {
      generations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            plan: { $ref: "#/components/schemas/PortfolioPlan" },
            ordinal: { type: "integer" },
            items: { type: "array", items: { $ref: "#/components/schemas/PortfolioPlanItem" } },
            claims: { type: "array", items: { $ref: "#/components/schemas/ValueClaim" } },
          },
        },
      },
    },
  },
};

const paths = {
  "/api/project-plans": {
    get: {
      tags: ["Portfolio Plans"],
      operationId: "listPortfolioPlans",
      summary:
        "List a project's portfolio plans (open + closed), nested items with per-item claims",
      parameters: [
        { name: "project_id", in: "query", required: true, schema: { type: "string" } },
        {
          name: "status",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["open", "closed"] },
        },
      ],
      responses: {
        200: {
          description: "Plans for the project",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  plans: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PortfolioPlanWithItems" },
                  },
                },
              },
            },
          },
        },
        400: {
          description: "project_id missing",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
    post: {
      tags: ["Portfolio Plans"],
      operationId: "createPortfolioPlan",
      summary: "Create a new open plan (manual create or a retroactive_bundle)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["project_id", "title"],
              properties: {
                project_id: { type: "string" },
                title: { type: "string" },
                succeeds_plan_id: { type: "integer", nullable: true },
                origin: { type: "string", enum: ["manual", "retroactive_bundle"] },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { plan: { $ref: "#/components/schemas/PortfolioPlan" } },
              },
            },
          },
        },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: errorRef } },
        },
        404: {
          description: "Project not found",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/pool": {
    get: {
      tags: ["Portfolio Plans"],
      operationId: "getValuePool",
      summary: "Assemble the live, derived value pool for a project",
      parameters: [
        { name: "project_id", in: "query", required: true, schema: { type: "string" } },
        { name: "lookbackDays", in: "query", required: false, schema: { type: "integer" } },
        { name: "backfill", in: "query", required: false, schema: { type: "string" } },
      ],
      responses: {
        200: {
          description: "Assembled pool",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ValuePool" } } },
        },
        400: {
          description: "project_id missing",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/health": {
    get: {
      tags: ["Portfolio Plans"],
      operationId: "getLedgerHealth",
      summary: "Plan health metrics for a project (verbatim T6 parity target)",
      parameters: [{ name: "project_id", in: "query", required: true, schema: { type: "string" } }],
      responses: {
        200: {
          description: "Health metrics",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LedgerHealth" } },
          },
        },
        400: {
          description: "project_id missing",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/history": {
    get: {
      tags: ["Portfolio Plans"],
      operationId: "getLedgerHistory",
      summary: "AC-6 whole-life delivered-value summary for a project",
      parameters: [{ name: "project_id", in: "query", required: true, schema: { type: "string" } }],
      responses: {
        200: {
          description: "Closed generations + claims",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LedgerHistory" } },
          },
        },
        400: {
          description: "project_id missing",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/import": {
    post: {
      tags: ["Portfolio Plans"],
      operationId: "importPortfolioPlan",
      summary:
        "DEC-P2 import: turn an ingested AGENT-PLAN.md into generation 1 (idempotent on content_hash)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["project_id", "cwd"],
              properties: { project_id: { type: "string" }, cwd: { type: "string" } },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Imported (or idempotent no-op re-import)",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  plan: { $ref: "#/components/schemas/PortfolioPlan" },
                  items: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PortfolioPlanItem" },
                  },
                  created: { type: "boolean" },
                },
              },
            },
          },
        },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: errorRef } },
        },
        404: {
          description: "Project or AGENT-PLAN.md not found",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/{id}": {
    get: {
      tags: ["Portfolio Plans"],
      operationId: "getPortfolioPlan",
      summary: "Read one plan with its items and per-item claims",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      responses: {
        200: {
          description: "Plan",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/PortfolioPlanWithItems" } },
          },
        },
        404: { description: "Not found", content: { "application/json": { schema: errorRef } } },
      },
    },
    patch: {
      tags: ["Portfolio Plans"],
      operationId: "updatePortfolioPlan",
      summary: "Rename an open plan (status can never be set here — see /close)",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: { title: { type: "string" } } },
          },
        },
      },
      responses: {
        200: {
          description: "Updated",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { plan: { $ref: "#/components/schemas/PortfolioPlan" } },
              },
            },
          },
        },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: errorRef } },
        },
        404: { description: "Not found", content: { "application/json": { schema: errorRef } } },
        409: {
          description: "Plan is closed",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/{id}/close": {
    post: {
      tags: ["Portfolio Plans"],
      operationId: "closePortfolioPlan",
      summary: "The only door to closed (DEC-P6) — the single closure composer",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { type: "object", properties: { closure_note: { type: "string" } } },
          },
        },
      },
      responses: {
        200: {
          description: "Closed",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { plan: { $ref: "#/components/schemas/PortfolioPlan" } },
              },
            },
          },
        },
        404: { description: "Not found", content: { "application/json": { schema: errorRef } } },
        409: {
          description: "Already closed",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/{id}/items": {
    post: {
      tags: ["Portfolio Plans"],
      operationId: "createPortfolioPlanItem",
      summary: "Add an item to an open plan",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["text"],
              properties: {
                text: { type: "string" },
                parent_item_id: { type: "integer", nullable: true },
                acceptance: { type: "string" },
                detail: { type: "string" },
                position: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { item: { $ref: "#/components/schemas/PortfolioPlanItem" } },
              },
            },
          },
        },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: errorRef } },
        },
        404: {
          description: "Plan not found",
          content: { "application/json": { schema: errorRef } },
        },
        409: {
          description: "Plan is closed",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/items/{itemId}": {
    patch: {
      tags: ["Portfolio Plans"],
      operationId: "updatePortfolioPlanItem",
      summary: "Update an item on an open plan",
      parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "integer" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                text: { type: "string" },
                acceptance: { type: "string" },
                detail: { type: "string" },
                checked: { type: "boolean" },
                position: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Updated",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { item: { $ref: "#/components/schemas/PortfolioPlanItem" } },
              },
            },
          },
        },
        404: { description: "Not found", content: { "application/json": { schema: errorRef } } },
        409: {
          description: "Plan is closed",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
    delete: {
      tags: ["Portfolio Plans"],
      operationId: "deletePortfolioPlanItem",
      summary: "Delete an item from an open plan",
      parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "integer" } }],
      responses: {
        200: {
          description: "Deleted",
          content: {
            "application/json": {
              schema: { type: "object", properties: { ok: { type: "boolean" } } },
            },
          },
        },
        404: { description: "Not found", content: { "application/json": { schema: errorRef } } },
        409: {
          description: "Plan is closed",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/{id}/claims": {
    post: {
      tags: ["Portfolio Plans"],
      operationId: "createValueClaim",
      summary: "Claim a value unit into an existing item, or an inline new_item created atomically",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["value_source", "value_ref", "attribution"],
              properties: {
                item_id: { type: "integer" },
                new_item: { type: "object" },
                value_source: {
                  type: "string",
                  enum: [
                    "trunk_commit",
                    "merge_commit",
                    "intake_initiative",
                    "detour",
                    "focus_segment",
                  ],
                },
                value_ref: { type: "string" },
                source_cwd: { type: "string" },
                label_snapshot: { type: "string" },
                seen_at_snapshot: { type: "string" },
                stage_snapshot: { type: "string" },
                attribution: { type: "string", enum: ["mechanical", "correlational", "judgment"] },
                claimed_by: { type: "string", enum: ["human", "llm"] },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Claimed",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { claim: { $ref: "#/components/schemas/ValueClaim" } },
              },
            },
          },
        },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: errorRef } },
        },
        404: {
          description: "Plan not found",
          content: { "application/json": { schema: errorRef } },
        },
        409: {
          description: "Plan is closed, or this unit is already claimed into this item",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
  "/api/project-plans/claims/{claimId}": {
    delete: {
      tags: ["Portfolio Plans"],
      operationId: "deleteValueClaim",
      summary: "Explicit human unclaim — rejected once the owning plan is closed",
      parameters: [{ name: "claimId", in: "path", required: true, schema: { type: "integer" } }],
      responses: {
        200: {
          description: "Unclaimed",
          content: {
            "application/json": {
              schema: { type: "object", properties: { ok: { type: "boolean" } } },
            },
          },
        },
        404: { description: "Not found", content: { "application/json": { schema: errorRef } } },
        409: {
          description: "Plan is closed — claims are immutable",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
};

module.exports = { tags, schemas, paths };
