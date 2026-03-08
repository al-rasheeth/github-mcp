import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { READ_ANNOTATION } from "./registry.js";
import { withOwnerDefault, buildQueryString } from "../utils/helpers.js";
import { formatRepoList } from "../utils/markdown.js";

export function registerOrgTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.tool(
    "list_org_members",
    "List members of an organization",
    {
      org: z.string().optional().describe("Organization name (uses GITHUB_DEFAULT_OWNER if omitted)"),
      role: z.enum(["all", "admin", "member"]).optional().default("all"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner: org } = withOwnerDefault({ owner: params.org }, config);
      const qs = buildQueryString({ role: params.role, per_page: params.per_page });
      const members = await client.paginate<Record<string, unknown>>(`/orgs/${org}/members${qs}`, undefined, 3);

      if (members.length === 0) return { content: [{ type: "text" as const, text: "No members found." }] };
      const lines = ["| User | Type | URL |", "| --- | --- | --- |"];
      for (const m of members) {
        lines.push(`| @${m.login} | ${m.type} | ${m.html_url} |`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "list_org_repos",
    "List repositories for an organization",
    {
      org: z.string().optional().describe("Organization name"),
      type: z.enum(["all", "public", "private", "forks", "sources", "member"]).optional().default("all"),
      sort: z.enum(["created", "updated", "pushed", "full_name"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner: org } = withOwnerDefault({ owner: params.org }, config);
      const qs = buildQueryString({ type: params.type, sort: params.sort, direction: params.direction, per_page: params.per_page });
      const repos = await client.paginate<Record<string, unknown>>(`/orgs/${org}/repos${qs}`, undefined, 3);
      return { content: [{ type: "text" as const, text: formatRepoList(repos) }] };
    }
  );

  server.tool(
    "list_teams",
    "List teams in an organization",
    {
      org: z.string().optional().describe("Organization name"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner: org } = withOwnerDefault({ owner: params.org }, config);
      const teams = await client.paginate<Record<string, unknown>>(`/orgs/${org}/teams?per_page=${params.per_page}`, undefined, 3);

      if (teams.length === 0) return { content: [{ type: "text" as const, text: "No teams found." }] };
      const lines = ["| ID | Name | Slug | Privacy | URL |", "| --- | --- | --- | --- | --- |"];
      for (const t of teams) {
        lines.push(`| ${t.id} | ${t.name} | \`${t.slug}\` | ${t.privacy} | ${t.html_url} |`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
