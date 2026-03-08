import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { READ_ANNOTATION } from "./registry.js";
import { formatSearchResults } from "../utils/markdown.js";

export function registerSearchTools(server: McpServer, ctx: ToolContext): void {
  const { client } = ctx;

  server.registerTool("search_code", {
    description: "Search code across repositories using GitHub code search syntax",
    inputSchema: {
      query: z.string().describe("Search query (e.g. 'addClass repo:jquery/jquery language:js')"),
      sort: z.enum(["indexed"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { data } = await client.octokit.rest.search.code({
      q: params.query,
      sort: params.sort,
      order: params.order,
      per_page: params.per_page,
    });
    return {
      content: [{ type: "text" as const, text: formatSearchResults(data.items as Record<string, unknown>[], "code", data.total_count) }],
    };
  });

  server.registerTool("search_repos", {
    description: "Search repositories",
    inputSchema: {
      query: z.string().describe("Search query (e.g. 'language:typescript stars:>100')"),
      sort: z.enum(["stars", "forks", "help-wanted-issues", "updated"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { data } = await client.octokit.rest.search.repos({
      q: params.query,
      sort: params.sort,
      order: params.order,
      per_page: params.per_page,
    });
    return {
      content: [{ type: "text" as const, text: formatSearchResults(data.items as Record<string, unknown>[], "repos", data.total_count) }],
    };
  });

  server.registerTool("search_users", {
    description: "Search users and organizations",
    inputSchema: {
      query: z.string().describe("Search query (e.g. 'type:org language:python')"),
      sort: z.enum(["followers", "repositories", "joined"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { data } = await client.octokit.rest.search.users({
      q: params.query,
      sort: params.sort,
      order: params.order,
      per_page: params.per_page,
    });
    return {
      content: [{ type: "text" as const, text: formatSearchResults(data.items as Record<string, unknown>[], "users", data.total_count) }],
    };
  });

  server.registerTool("search_commits", {
    description: "Search commits",
    inputSchema: {
      query: z.string().describe("Search query (e.g. 'fix bug repo:owner/repo')"),
      sort: z.enum(["author-date", "committer-date"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { data } = await client.octokit.rest.search.commits({
      q: params.query,
      sort: params.sort,
      order: params.order,
      per_page: params.per_page,
    });
    return {
      content: [{ type: "text" as const, text: formatSearchResults(data.items as Record<string, unknown>[], "commits", data.total_count) }],
    };
  });
}
