/**
 * @file Supplementary OpenAPI 3.0 fragments for the Coach's Playbook routes:
 *   - GET /api/playbook/practices              (Playbook)
 *   - PUT /api/playbook/practices/{id}/config  (Playbook)
 *   - GET /api/coach/observations               (Coach)
 *   - POST /api/coach/observations/{id}/respond (Coach)
 *
 * Playbook (server/routes/playbook.js) exposes the catalog of rule-based
 * "practices" the Coach engine (server/lib/playbook/engine.js) evaluates on
 * a tick, plus each practice's user-editable config — server-shared, since
 * this app has no user accounts. Coach (server/routes/coach.js) exposes the
 * Observations that engine records when a practice's condition fires,
 * scoped to a session/project/global target, and lets a user respond to one
 * (acknowledge/dismiss/resolve). Exports `{ tags, schemas, paths }` for
 * merging into the base spec by `createOpenApiSpec()` via
 * server/openapi-extra.js. Schemas are prefixed `Playbook`/`Coach` to avoid
 * collisions with the base component schemas. Error responses reuse the
 * base `ErrorResponse` schema (`{ error: { code, message } }`), which is
 * the shape these routes actually emit.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const errorRef = { $ref: "#/components/schemas/ErrorResponse" };

const tags = [
  {
    name: "Playbook",
    description:
      "The Coach's Playbook — the catalog of rule-based practices the Coach engine evaluates, and their user-editable config",
  },
  {
    name: "Coach",
    description:
      "The Coach's Feed — Observations the Playbook engine records when a practice's condition fires, and the user's response to each",
  },
];

const schemas = {
  PlaybookField: {
    type: "object",
    required: ["key", "type", "default", "min"],
    description:
      'One configurable numeric field on a practice. v1 practices only expose `type: "number"` fields (a threshold), so `default` and `min` are both numbers; `min` is the floor enforced by `PUT /api/playbook/practices/:id/config`.',
    properties: {
      key: {
        type: "string",
        description: "Config object key this field controls.",
        example: "thresholdTokens",
      },
      type: {
        type: "string",
        enum: ["number"],
        description: 'Field\'s value type. Only `"number"` exists in v1.',
        example: "number",
      },
      default: {
        type: "number",
        description: "Value used when the practice has never been configured.",
        example: 100000000,
      },
      min: {
        type: "number",
        description:
          "Minimum accepted value. `PUT /api/playbook/practices/:id/config` rejects a lower value with 400 `INVALID_CONFIG`.",
        example: 1000000,
      },
    },
  },

  PlaybookPractice: {
    type: "object",
    required: ["id", "category", "scope", "kind", "defaultSeverity", "fields", "enabled", "config"],
    description:
      "A catalog practice merged with its current stored config (or the catalog defaults, if never touched). This is the shape every entry in `GET /api/playbook/practices` has, and also the shape `PUT /api/playbook/practices/:id/config` returns for the one practice it updated.",
    properties: {
      id: {
        type: "string",
        description: "Stable practice id, also the `:id` path param for the config PUT.",
        example: "session-token-ceiling",
      },
      category: {
        type: "string",
        description: "Grouping label for the Playbook UI.",
        example: "context-management",
      },
      scope: {
        type: "string",
        enum: ["session", "project", "global"],
        description:
          'What one Observation from this practice is scoped to. v1\'s engine only evaluates `"session"`-scoped practices.',
        example: "session",
      },
      kind: {
        type: "string",
        enum: ["risk", "info", "good"],
        description: "Nature of the Observation this practice produces when it fires.",
        example: "risk",
      },
      defaultSeverity: {
        type: "string",
        description: "Severity stamped onto Observations this practice creates.",
        example: "warning",
      },
      fields: {
        type: "array",
        description: "The practice's configurable fields (see `PlaybookField`).",
        items: { $ref: "#/components/schemas/PlaybookField" },
      },
      enabled: {
        type: "boolean",
        description: "Whether the Coach engine currently evaluates this practice.",
        example: true,
      },
      config: {
        type: "object",
        description:
          "Current config, keyed by each field's `key`. Values are numbers; a key absent from stored config falls back to that field's `default`.",
        additionalProperties: { type: "number" },
        example: { thresholdTokens: 100000000 },
      },
    },
  },

  PlaybookPracticesResponse: {
    type: "object",
    required: ["practices"],
    description: "Every catalog practice, merged with its current config.",
    properties: {
      practices: {
        type: "array",
        items: { $ref: "#/components/schemas/PlaybookPractice" },
      },
    },
  },

  PlaybookConfigPatchRequest: {
    type: "object",
    description:
      "Patch for one practice's `enabled`/`config`. Both fields are optional and independent — an omitted field keeps its current stored value (or catalog default if never configured); `config` itself is also a patch, so only the keys you supply are overwritten, not the whole object.",
    properties: {
      enabled: {
        type: "boolean",
        description: "New enabled state for the practice. Omit to leave unchanged.",
        example: true,
      },
      config: {
        type: "object",
        description:
          "Field values to overwrite, keyed by each field's `key`. Every key must match one of the practice's own `fields[].key`; every value must be a finite number at or above that field's `min`.",
        additionalProperties: { type: "number" },
        example: { thresholdTokens: 150000000 },
      },
    },
  },

  CoachObservation: {
    type: "object",
    required: [
      "id",
      "practice_id",
      "scope_type",
      "scope_id",
      "kind",
      "severity",
      "values_json",
      "status",
      "detected_at",
      "responded_at",
    ],
    description:
      "One recorded firing of a Playbook practice. `values_json` is a JSON-ENCODED STRING (not a nested object) so the row can be stored/returned verbatim regardless of which values a given practice captured — callers `JSON.parse` it to read the practice-specific numbers.",
    properties: {
      id: { type: "integer", description: "Row id.", example: 42 },
      practice_id: {
        type: "string",
        description: "Which catalog practice produced this Observation.",
        example: "session-token-ceiling",
      },
      scope_type: {
        type: "string",
        enum: ["session", "project", "global"],
        description: "What `scope_id` identifies.",
        example: "session",
      },
      scope_id: {
        type: "string",
        nullable: true,
        description:
          'The session/project id this Observation is about; `null` for `scope_type: "global"`.',
        example: "5f3c0e2a-1b9d-4c77-8a21-9e0f7b6d4c11",
      },
      kind: {
        type: "string",
        enum: ["risk", "info", "good"],
        description: "Copied from the practice's own `kind` at detection time.",
        example: "risk",
      },
      severity: {
        type: "string",
        description: "Copied from the practice's `defaultSeverity` at detection time.",
        example: "warning",
      },
      values_json: {
        type: "string",
        description:
          "JSON-encoded object of the practice-specific values that triggered detection, e.g. the session's total tokens against the configured threshold.",
        example: '{"totalTokens":150000000,"thresholdTokens":100000000}',
      },
      status: {
        type: "string",
        enum: ["open", "acknowledged", "dismissed", "resolved"],
        description: 'Starts `"open"`; moves to one of the other three via `POST .../respond`.',
        example: "open",
      },
      detected_at: {
        type: "string",
        format: "date-time",
        description: "When the Coach engine recorded this Observation.",
        example: "2026-07-24T18:41:55.117Z",
      },
      responded_at: {
        type: "string",
        format: "date-time",
        nullable: true,
        description: 'When the user responded; `null` while `status` is still `"open"`.',
        example: null,
      },
    },
  },

  CoachObservationsResponse: {
    type: "object",
    required: ["observations"],
    description: "Observations, most recent (`detected_at`) first.",
    properties: {
      observations: {
        type: "array",
        items: { $ref: "#/components/schemas/CoachObservation" },
      },
    },
  },

  CoachRespondRequest: {
    type: "object",
    required: ["response"],
    description: "The user's response to one Observation.",
    properties: {
      response: {
        type: "string",
        enum: ["acknowledged", "dismissed", "resolved"],
        description: "New `status` for the Observation.",
        example: "acknowledged",
      },
    },
  },
};

const paths = {
  "/api/playbook/practices": {
    get: {
      tags: ["Playbook"],
      summary: "List Playbook practices",
      description:
        "Returns every catalog practice merged with its stored config (or the catalog defaults, if a practice has never been configured). v1 ships exactly one practice, `session-token-ceiling` (category `context-management`, scope `session`, kind `risk`) — a threshold on a session's total token usage. No authentication — this is a local-first dashboard.",
      operationId: "listPlaybookPractices",
      responses: {
        200: {
          description: "Every catalog practice with its current config",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PlaybookPracticesResponse" },
              example: {
                practices: [
                  {
                    id: "session-token-ceiling",
                    category: "context-management",
                    scope: "session",
                    kind: "risk",
                    defaultSeverity: "warning",
                    fields: [
                      {
                        key: "thresholdTokens",
                        type: "number",
                        default: 100000000,
                        min: 1000000,
                      },
                    ],
                    enabled: true,
                    config: { thresholdTokens: 100000000 },
                  },
                ],
              },
            },
          },
        },
      },
    },
  },

  "/api/playbook/practices/{id}/config": {
    put: {
      tags: ["Playbook"],
      summary: "Patch one practice's enabled state and/or config",
      description:
        "Patches `enabled` and/or `config` for one catalog practice and persists it (server-shared — this app has no user accounts, so the change applies to every connected computer). `config` values are validated against that practice's own `fields` schema: unknown field names, non-finite numbers, and values below a field's `min` are all rejected. On success, broadcasts the merged practice over the WebSocket as `playbook_practice_config_updated` so every other connected client picks it up live, and returns that same merged practice. No authentication (local-first).",
      operationId: "updatePlaybookPracticeConfig",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Practice id (e.g. `session-token-ceiling`).",
          example: "session-token-ceiling",
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PlaybookConfigPatchRequest" },
            example: { enabled: true, config: { thresholdTokens: 150000000 } },
          },
        },
      },
      responses: {
        200: {
          description: "Merged practice after applying the patch",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PlaybookPractice" },
              example: {
                id: "session-token-ceiling",
                category: "context-management",
                scope: "session",
                kind: "risk",
                defaultSeverity: "warning",
                fields: [
                  { key: "thresholdTokens", type: "number", default: 100000000, min: 1000000 },
                ],
                enabled: true,
                config: { thresholdTokens: 150000000 },
              },
            },
          },
        },
        400: {
          description:
            "Invalid config: an unknown field name, a non-finite-number value, or a value below that field's `min`",
          content: {
            "application/json": {
              schema: errorRef,
              example: {
                error: {
                  code: "INVALID_CONFIG",
                  message: "thresholdTokens must be at least 1000000",
                },
              },
            },
          },
        },
        404: {
          description: "No practice with that id in the catalog",
          content: {
            "application/json": {
              schema: errorRef,
              example: { error: { code: "UNKNOWN_PRACTICE", message: "no such practice" } },
            },
          },
        },
      },
    },
  },

  "/api/coach/observations": {
    get: {
      tags: ["Coach"],
      summary: "List Coach Observations",
      description:
        "Returns recorded Observations, most recent first. Optionally narrow to one `status`. No authentication (local-first).",
      operationId: "listCoachObservations",
      parameters: [
        {
          name: "status",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["open", "acknowledged", "dismissed", "resolved"],
          },
          description: "Filter to Observations currently in this status. Omit for all statuses.",
        },
      ],
      responses: {
        200: {
          description: "Observations, most recent first",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CoachObservationsResponse" },
              example: {
                observations: [
                  {
                    id: 42,
                    practice_id: "session-token-ceiling",
                    scope_type: "session",
                    scope_id: "5f3c0e2a-1b9d-4c77-8a21-9e0f7b6d4c11",
                    kind: "risk",
                    severity: "warning",
                    values_json: '{"totalTokens":150000000,"thresholdTokens":100000000}',
                    status: "open",
                    detected_at: "2026-07-24T18:41:55.117Z",
                    responded_at: null,
                  },
                ],
              },
            },
          },
        },
        400: {
          description: "`status` is not one of open/acknowledged/dismissed/resolved",
          content: {
            "application/json": {
              schema: errorRef,
              example: { error: { code: "INVALID_STATUS", message: "unknown status filter" } },
            },
          },
        },
      },
    },
  },

  "/api/coach/observations/{id}/respond": {
    post: {
      tags: ["Coach"],
      summary: "Respond to a Coach Observation",
      description:
        "Records the user's response to one Observation (acknowledge, dismiss, or resolve) and moves its `status` accordingly. Broadcasts the updated row over the WebSocket as `coach_observation_updated` so every other connected client's Feed reflects it live, and returns that same row. (A brand-new Observation is broadcast separately, as `coach_observation_created`, by the Playbook engine itself on the tick that produces it — not by this route.) No authentication (local-first).",
      operationId: "respondToCoachObservation",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer" },
          description: "Observation row id.",
          example: 42,
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CoachRespondRequest" },
            example: { response: "acknowledged" },
          },
        },
      },
      responses: {
        200: {
          description: "Updated Observation",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CoachObservation" },
              example: {
                id: 42,
                practice_id: "session-token-ceiling",
                scope_type: "session",
                scope_id: "5f3c0e2a-1b9d-4c77-8a21-9e0f7b6d4c11",
                kind: "risk",
                severity: "warning",
                values_json: '{"totalTokens":150000000,"thresholdTokens":100000000}',
                status: "acknowledged",
                detected_at: "2026-07-24T18:41:55.117Z",
                responded_at: "2026-07-24T19:02:10.000Z",
              },
            },
          },
        },
        400: {
          description: "`response` is not one of acknowledged/dismissed/resolved",
          content: {
            "application/json": {
              schema: errorRef,
              example: {
                error: {
                  code: "INVALID_RESPONSE",
                  message: "response must be one of: acknowledged, dismissed, resolved",
                },
              },
            },
          },
        },
        404: {
          description: "No Observation with that id",
          content: {
            "application/json": {
              schema: errorRef,
              example: { error: { code: "NOT_FOUND", message: "no such observation" } },
            },
          },
        },
      },
    },
  },
};

module.exports = { tags, schemas, paths };
