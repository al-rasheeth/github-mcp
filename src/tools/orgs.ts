import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { READ_ANNOTATION } from "./registry.js";
import { withOwnerDefault } from "../utils/helpers.js";
import { formatRepoList } from "../utils/markdown.js";

export function registerOrgTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("list_org_members", {
    description: "List members of an organization",
    inputSchema: {
      org: z.string().optional().describe("Organization name (uses GITHUB_DEFAULT_OWNER if omitted)"),
      role: z.enum(["all", "admin", "member"]).optional().default("all"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner: org } = withOwnerDefault({ owner: params.org }, config);
    const members = await client.octokit.paginate(client.octokit.rest.orgs.listMembers, {
      org,
      role: params.role,
      per_page: params.per_page,
    });

    if (members.length === 0) return { content: [{ type: "text" as const, text: "No members found." }] };
    const lines = ["| User | Type | URL |", "| --- | --- | --- |"];
    for (const m of members as Record<string, unknown>[]) {
      lines.push(`| @${m.login} | ${m.type} | ${m.html_url} |`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("list_org_repos", {
    description: "List repositories for an organization",
    inputSchema: {
      org: z.string().optional().describe("Organization name"),
      type: z.enum(["all", "public", "private", "forks", "sources", "member"]).optional().default("all"),
      sort: z.enum(["created", "updated", "pushed", "full_name"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner: org } = withOwnerDefault({ owner: params.org }, config);
    const repos = await client.octokit.paginate(client.octokit.rest.repos.listForOrg, {
      org,
      type: params.type,
      sort: params.sort,
      direction: params.direction,
      per_page: params.per_page,
    });
    return { content: [{ type: "text" as const, text: formatRepoList(repos as Record<string, unknown>[]) }] };
  });

  server.registerTool("list_teams", {
    description: "List teams in an organization",
    inputSchema: {
      org: z.string().optional().describe("Organization name"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner: org } = withOwnerDefault({ owner: params.org }, config);
    const teams = await client.octokit.paginate(client.octokit.rest.teams.list, {
      org,
      per_page: params.per_page,
    });

    if (teams.length === 0) return { content: [{ type: "text" as const, text: "No teams found." }] };
    const lines = ["| ID | Name | Slug | Privacy | URL |", "| --- | --- | --- | --- | --- |"];
    for (const t of teams as Record<string, unknown>[]) {
      lines.push(`| ${t.id} | ${t.name} | \`${t.slug}\` | ${t.privacy} | ${t.html_url} |`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });
}
