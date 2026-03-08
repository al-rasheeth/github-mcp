import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { READ_ANNOTATION } from "./registry.js";
import { withDefaults, buildQueryString } from "../utils/helpers.js";
import { formatCommit, formatCommitList } from "../utils/markdown.js";

export function registerCommitTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.tool(
    "list_commits",
    "List commits on a branch or path with pagination",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      sha: z.string().optional().describe("Branch name or commit SHA to start from"),
      path: z.string().optional().describe("Only commits affecting this file path"),
      author: z.string().optional().describe("GitHub login or email"),
      since: z.string().optional().describe("ISO 8601 date"),
      until: z.string().optional().describe("ISO 8601 date"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = buildQueryString({
        sha: params.sha, path: params.path, author: params.author,
        since: params.since, until: params.until, per_page: params.per_page,
      });
      const commits = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/commits${qs}`, undefined, 3
      );
      return { content: [{ type: "text" as const, text: formatCommitList(commits) }] };
    }
  );

  server.tool(
    "get_commit",
    "Get full commit details with diff stats and changed files",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      ref: z.string().describe("Commit SHA, branch, or tag"),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/commits/${params.ref}`);
      return { content: [{ type: "text" as const, text: formatCommit(resp.data) }] };
    }
  );

  server.tool(
    "compare_commits",
    "Compare two commits or refs",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      base: z.string().describe("Base ref"),
      head: z.string().describe("Head ref"),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<Record<string, unknown>>(
        `/repos/${owner}/${repo}/compare/${params.base}...${params.head}`
      );
      const data = resp.data;
      const lines = [
        `# Compare \`${params.base}\` ← \`${params.head}\``,
        "",
        "| Metric | Value |",
        "| --- | --- |",
        `| **Status** | ${data.status} |`,
        `| **Ahead by** | ${data.ahead_by} commits |`,
        `| **Behind by** | ${data.behind_by} commits |`,
        `| **Total commits** | ${data.total_commits} |`,
      ];

      const commits = data.commits as Array<Record<string, unknown>> | undefined;
      if (commits?.length) {
        lines.push("", "## Commits", "", formatCommitList(commits));
      }

      const files = data.files as Array<Record<string, unknown>> | undefined;
      if (files?.length) {
        lines.push("", "## Changed Files", "", "| File | Status | Changes |", "| --- | --- | --- |");
        for (const f of files) {
          lines.push(`| \`${f.filename}\` | ${f.status} | +${f.additions}/-${f.deletions} |`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
