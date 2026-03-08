import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled } from "./registry.js";
import { buildQueryString } from "../utils/helpers.js";
import { formatGist, formatGistList } from "../utils/markdown.js";

export function registerGistTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.tool(
    "list_gists",
    "List gists for the authenticated user or a specified user",
    {
      username: z.string().optional().describe("User login (omit for authenticated user)"),
      since: z.string().optional().describe("ISO 8601 timestamp to filter by"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const qs = buildQueryString({ since: params.since, per_page: params.per_page });
      const path = params.username ? `/users/${params.username}/gists${qs}` : `/gists${qs}`;
      const gists = await client.paginate<Record<string, unknown>>(path, undefined, 3);
      return { content: [{ type: "text" as const, text: formatGistList(gists) }] };
    }
  );

  server.tool(
    "get_gist",
    "Get a gist with all file contents",
    {
      gist_id: z.string().describe("Gist ID"),
    },
    async (params) => {
      const resp = await client.get<Record<string, unknown>>(`/gists/${params.gist_id}`);
      return { content: [{ type: "text" as const, text: formatGist(resp.data) }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "create_gist",
      "Create a new gist",
      {
        description: z.string().optional(),
        public: z.boolean().optional().default(false),
        files: z.record(z.object({
          content: z.string(),
        })).describe("Map of filename to content"),
      },
      async (params) => {
        const resp = await client.post<Record<string, unknown>>("/gists", params);
        return { content: [{ type: "text" as const, text: formatGist(resp.data) }] };
      }
    );

    server.tool(
      "update_gist",
      "Update an existing gist",
      {
        gist_id: z.string(),
        description: z.string().optional(),
        files: z.record(z.object({
          content: z.string().optional(),
          filename: z.string().optional(),
        }).nullable()).describe("Map of filename to content (null to delete a file)"),
      },
      async (params) => {
        const { gist_id, ...body } = params;
        const resp = await client.patch<Record<string, unknown>>(`/gists/${gist_id}`, body);
        return { content: [{ type: "text" as const, text: formatGist(resp.data) }] };
      }
    );
  }
}
