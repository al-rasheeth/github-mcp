import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { READ_ANNOTATION } from "./registry.js";
import { withDefaults } from "../utils/helpers.js";
import { formatCommit, formatCommitList } from "../utils/markdown.js";

export function registerCommitTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("list_commits", {
    description: "List commits on a branch or path with pagination",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      sha: z.string().optional().describe("Branch name or commit SHA to start from"),
      path: z.string().optional().describe("Only commits affecting this file path"),
      author: z.string().optional().describe("GitHub login or email"),
      since: z.string().optional().describe("ISO 8601 date"),
      until: z.string().optional().describe("ISO 8601 date"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const commits = await client.octokit.paginate(client.octokit.rest.repos.listCommits, {
      owner,
      repo,
      sha: params.sha,
      path: params.path,
      author: params.author,
      since: params.since,
      until: params.until,
      per_page: params.per_page,
    });
    return { content: [{ type: "text" as const, text: formatCommitList(commits as Record<string, unknown>[]) }] };
  });

  server.registerTool("get_commit", {
    description: "Get full commit details with diff stats and changed files",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      ref: z.string().describe("Commit SHA, branch, or tag"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.repos.getCommit({ owner, repo, ref: params.ref });
    return { content: [{ type: "text" as const, text: formatCommit(data as Record<string, unknown>) }] };
  });

  server.registerTool("compare_commits", {
    description: "Compare two commits or refs",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      base: z.string().describe("Base ref"),
      head: z.string().describe("Head ref"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.repos.compareCommits({
      owner,
      repo,
      base: params.base,
      head: params.head,
    });
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
  });
}
