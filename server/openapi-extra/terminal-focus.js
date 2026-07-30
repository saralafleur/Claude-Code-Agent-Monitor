/**
 * @file Supplementary OpenAPI fragment for the jump-to-terminal action
 * (`/api/sessions/{id}/focus-terminal`), a previously-undocumented gap in the
 * base spec. Exports `{ tags, schemas, paths }` for merging by
 * server/openapi-extra.js. No new schemas — the route takes no request body
 * and its only success shape is `{ ok: true }`.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const tags = [];

const schemas = {};

const errorRef = { $ref: "#/components/schemas/ErrorResponse" };

const paths = {
  "/api/sessions/{id}/focus-terminal": {
    post: {
      tags: ["Sessions"],
      operationId: "focusSessionTerminal",
      summary: "Jump to the Terminal.app tab running this session (macOS only)",
      description:
        "Resolves the session's recorded OS process id, verifies the `claude` process is still alive, and uses AppleScript to select and briefly flash the matching Terminal.app tab so it's visually unmistakable. Every failure mode is an expected, typed reason rather than a server bug — see the response codes below.",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: {
          description: "The matching Terminal.app tab was found, selected, and flashed",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { ok: { type: "boolean", enum: [true] } },
              },
            },
          },
        },
        404: {
          description:
            "Session not found (NOT_FOUND), or no Terminal.app tab matched the session's process (TERMINAL_NOT_FOUND)",
          content: { "application/json": { schema: errorRef } },
        },
        409: {
          description:
            "NOT_LOCAL (session was collected from another machine) or NO_PID (no process id was ever recorded for this session)",
          content: { "application/json": { schema: errorRef } },
        },
        410: {
          description: "PROCESS_GONE — the session's claude process is no longer running",
          content: { "application/json": { schema: errorRef } },
        },
        500: {
          description:
            "AUTOMATION_ERROR — Terminal automation failed, commonly because macOS hasn't yet granted this app Automation access to control Terminal",
          content: { "application/json": { schema: errorRef } },
        },
        501: {
          description: "UNSUPPORTED_PLATFORM — this feature only supports macOS (Terminal.app)",
          content: { "application/json": { schema: errorRef } },
        },
      },
    },
  },
};

module.exports = { tags, schemas, paths };
