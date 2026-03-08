import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { withDefaults, buildQueryString } from "../utils/helpers.js";
import { formatIssue, formatIssueList, formatCommentList, formatMilestoneList, formatSearchResults } from "../utils/markdown.js";

export function registerIssueTools(server: McpServer, ctx: ToolContext): void {
  const { client, config, cache } = ctx;

  server.tool(
    "search_issues",
    "Search issues and pull requests using GitHub search syntax",
    {
      query: z.string().describe("GitHub search query (e.g. 'is:issue is:open label:bug repo:owner/repo')"),
      sort: z.enum(["comments", "reactions", "reactions-+1", "reactions--1", "interactions", "created", "updated"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const qs = buildQueryString({ q: params.query, sort: params.sort, order: params.order, per_page: params.per_page });
      const resp = await client.get<{ total_count: number; items: Record<string, unknown>[] }>(`/search/issues${qs}`);
      return { content: [{ type: "text" as const, text: formatSearchResults(resp.data.items, "issues", resp.data.total_count) }] };
    }
  );

  server.tool(
    "list_issues",
    "List issues for a repository with filtering options",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      state: z.enum(["open", "closed", "all"]).optional().default("open"),
      labels: z.string().optional().describe("Comma-separated label names"),
      assignee: z.string().optional(),
      milestone: z.string().optional().describe("Milestone number or '*' or 'none'"),
      sort: z.enum(["created", "updated", "comments"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = buildQueryString({
        state: params.state, labels: params.labels, assignee: params.assignee,
        milestone: params.milestone, sort: params.sort, direction: params.direction,
        per_page: params.per_page,
      });
      const issues = await client.paginate<Record<string, unknown>>(`/repos/${owner}/${repo}/issues${qs}`, undefined, 3);
      const filtered = issues.filter((i) => !i.pull_request);
      return { content: [{ type: "text" as const, text: formatIssueList(filtered) }] };
    }
  );

  server.tool(
    "get_issue",
    "Get full issue details with body, labels, assignees, milestone",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      issue_number: z.number().describe("Issue number"),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const { data } = await client.cachedGet<Record<string, unknown>>(
        `/repos/${owner}/${repo}/issues/${params.issue_number}`,
        `issues:${owner}/${repo}:${params.issue_number}`, "issues"
      );
      return { content: [{ type: "text" as const, text: formatIssue(data) }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "create_issue",
      "Create a new issue",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        title: z.string().describe("Issue title"),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
        assignees: z.array(z.string()).optional(),
        milestone: z.number().optional(),
      },
      WRITE_ANNOTATION,
      async (params) => {
        const { owner, repo, ...body } = withDefaults(params, config);
        const resp = await client.post<Record<string, unknown>>(`/repos/${owner}/${repo}/issues`, body);
        cache.invalidatePrefix(`issues:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: formatIssue(resp.data) }] };
      }
    );

    server.tool(
      "update_issue",
      "Update an existing issue",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        labels: z.array(z.string()).optional(),
        assignees: z.array(z.string()).optional(),
        milestone: z.number().nullable().optional(),
      },
      WRITE_ANNOTATION,
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const { issue_number, ...body } = params;
        const resp = await client.patch<Record<string, unknown>>(`/repos/${owner}/${repo}/issues/${issue_number}`, body);
        cache.invalidatePrefix(`issues:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: formatIssue(resp.data) }] };
      }
    );

    server.tool(
      "add_issue_comment",
      "Add a comment to an issue",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        body: z.string().describe("Comment body (markdown)"),
      },
      WRITE_ANNOTATION,
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const resp = await client.post<Record<string, unknown>>(
          `/repos/${owner}/${repo}/issues/${params.issue_number}/comments`,
          { body: params.body }
        );
        return { content: [{ type: "text" as const, text: `Comment added: ${resp.data.html_url}` }] };
      }
    );

    server.tool(
      "add_issue_labels",
      "Add labels to an issue",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        labels: z.array(z.string()).describe("Labels to add"),
      },
      WRITE_ANNOTATION,
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const resp = await client.post<Array<Record<string, unknown>>>(
          `/repos/${owner}/${repo}/issues/${params.issue_number}/labels`,
          { labels: params.labels }
        );
        const names = resp.data.map((l) => `\`${l.name}\``).join(", ");
        return { content: [{ type: "text" as const, text: `Labels on issue #${params.issue_number}: ${names}` }] };
      }
    );

    server.tool(
      "remove_issue_label",
      "Remove a label from an issue",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        label: z.string().describe("Label name to remove"),
      },
      WRITE_ANNOTATION,
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        await client.delete(`/repos/${owner}/${repo}/issues/${params.issue_number}/labels/${encodeURIComponent(params.label)}`);
        return { content: [{ type: "text" as const, text: `Label \`${params.label}\` removed from issue #${params.issue_number}.` }] };
      }
    );

    server.tool(
      "lock_issue",
      "Lock an issue conversation",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        lock_reason: z.enum(["off-topic", "too heated", "resolved", "spam"]).optional(),
      },
      WRITE_ANNOTATION,
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const body = params.lock_reason ? { lock_reason: params.lock_reason } : undefined;
        await client.put(`/repos/${owner}/${repo}/issues/${params.issue_number}/lock`, body);
        return { content: [{ type: "text" as const, text: `Issue #${params.issue_number} has been locked.` }] };
      }
    );
  }

  server.tool(
    "list_issue_comments",
    "List comments on an issue",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      issue_number: z.number(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const comments = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/issues/${params.issue_number}/comments?per_page=${params.per_page}`,
        undefined, 3
      );
      return { content: [{ type: "text" as const, text: formatCommentList(comments) }] };
    }
  );

  server.tool(
    "list_milestones",
    "List milestones for a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      state: z.enum(["open", "closed", "all"]).optional().default("open"),
      sort: z.enum(["due_on", "completeness"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = buildQueryString({ state: params.state, sort: params.sort, direction: params.direction });
      const milestones = await client.paginate<Record<string, unknown>>(`/repos/${owner}/${repo}/milestones${qs}`, undefined, 3);
      return { content: [{ type: "text" as const, text: formatMilestoneList(milestones) }] };
    }
  );
}
