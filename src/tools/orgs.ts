import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { READ_ANNOTATION } from "./registry.js";
import { withOwnerDefault } from "../utils/helpers.js";
import { content } from "../utils/toon.js";

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

    if (members.length === 0) return content({ members: [] });
    return content(members);
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
    return content(repos);
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

    if (teams.length === 0) return content({ teams: [] });
    return content(teams);
  });
}
