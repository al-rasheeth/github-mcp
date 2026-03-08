import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { buildQueryString } from "../utils/helpers.js";
import { formatSearchResults, formatCommitList } from "../utils/markdown.js";

export function registerSearchTools(server: McpServer, ctx: ToolContext): void {
  const { client } = ctx;

  server.tool(
    "search_code",
    "Search code across repositories using GitHub code search syntax",
    {
      query: z.string().describe("Search query (e.g. 'addClass repo:jquery/jquery language:js')"),
      sort: z.enum(["indexed"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const qs = buildQueryString({ q: params.query, sort: params.sort, order: params.order, per_page: params.per_page });
      const resp = await client.get<{ total_count: number; items: Record<string, unknown>[] }>(`/search/code${qs}`);
      return { content: [{ type: "text" as const, text: formatSearchResults(resp.data.items, "code", resp.data.total_count) }] };
    }
  );

  server.tool(
    "search_repos",
    "Search repositories",
    {
      query: z.string().describe("Search query (e.g. 'language:typescript stars:>100')"),
      sort: z.enum(["stars", "forks", "help-wanted-issues", "updated"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const qs = buildQueryString({ q: params.query, sort: params.sort, order: params.order, per_page: params.per_page });
      const resp = await client.get<{ total_count: number; items: Record<string, unknown>[] }>(`/search/repositories${qs}`);
      return { content: [{ type: "text" as const, text: formatSearchResults(resp.data.items, "repos", resp.data.total_count) }] };
    }
  );

  server.tool(
    "search_users",
    "Search users and organizations",
    {
      query: z.string().describe("Search query (e.g. 'type:org language:python')"),
      sort: z.enum(["followers", "repositories", "joined"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const qs = buildQueryString({ q: params.query, sort: params.sort, order: params.order, per_page: params.per_page });
      const resp = await client.get<{ total_count: number; items: Record<string, unknown>[] }>(`/search/users${qs}`);
      return { content: [{ type: "text" as const, text: formatSearchResults(resp.data.items, "users", resp.data.total_count) }] };
    }
  );

  server.tool(
    "search_commits",
    "Search commits",
    {
      query: z.string().describe("Search query (e.g. 'fix bug repo:owner/repo')"),
      sort: z.enum(["author-date", "committer-date"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const qs = buildQueryString({ q: params.query, sort: params.sort, order: params.order, per_page: params.per_page });
      const resp = await client.get<{ total_count: number; items: Record<string, unknown>[] }>(`/search/commits${qs}`, {
        headers: { Accept: "application/vnd.github.cloak-preview+json" },
      });
      return { content: [{ type: "text" as const, text: formatSearchResults(resp.data.items, "commits", resp.data.total_count) }] };
    }
  );
}
