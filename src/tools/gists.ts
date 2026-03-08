import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { formatGist, formatGistList } from "../utils/markdown.js";

export function registerGistTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("list_gists", {
    description: "List gists for the authenticated user or a specified user",
    inputSchema: {
      username: z.string().optional().describe("User login (omit for authenticated user)"),
      since: z.string().optional().describe("ISO 8601 timestamp to filter by"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    let gists: Record<string, unknown>[];
    if (params.username) {
      const { data } = await client.octokit.rest.gists.listForUser({
        username: params.username,
        per_page: params.per_page,
        since: params.since,
      });
      gists = data as Record<string, unknown>[];
    } else {
      const { data } = await client.octokit.rest.gists.list({
        per_page: params.per_page,
        since: params.since,
      });
      gists = data as Record<string, unknown>[];
    }
    return { content: [{ type: "text" as const, text: formatGistList(gists) }] };
  });

  server.registerTool("get_gist", {
    description: "Get a gist with all file contents",
    inputSchema: {
      gist_id: z.string().describe("Gist ID"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { data } = await client.octokit.rest.gists.get({ gist_id: params.gist_id });
    return { content: [{ type: "text" as const, text: formatGist(data as Record<string, unknown>) }] };
  });

  if (isGateEnabled("write", config)) {
    server.registerTool("create_gist", {
      description: "Create a new gist",
      inputSchema: {
        description: z.string().optional(),
        public: z.boolean().optional().default(false),
        files: z.record(z.object({
          content: z.string(),
        })).describe("Map of filename to content"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { data } = await client.octokit.rest.gists.create({
        description: params.description,
        public: params.public,
        files: params.files,
      });
      return { content: [{ type: "text" as const, text: formatGist(data as Record<string, unknown>) }] };
    });

    server.registerTool("update_gist", {
      description: "Update an existing gist",
      inputSchema: {
        gist_id: z.string(),
        description: z.string().optional(),
        files: z.record(z.object({
          content: z.string().optional(),
          filename: z.string().optional(),
        }).nullable()).describe("Map of filename to content (null to delete a file)"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { gist_id, ...body } = params;
      // GitHub API accepts null file values to delete files; Octokit types don't reflect this
      const { data } = await client.octokit.rest.gists.update({
        gist_id,
        description: body.description,
        // @ts-expect-error - API supports null to delete files
        files: body.files,
      });
      return { content: [{ type: "text" as const, text: formatGist(data as Record<string, unknown>) }] };
    });
  }
}
