import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { withDefaults } from "../utils/helpers.js";
import { toonFormat } from "../utils/toon.js";

export function registerIssueTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("search_issues", {
    description: "Search issues and pull requests using GitHub search syntax",
    inputSchema: {
      query: z.string().describe("GitHub search query (e.g. 'is:issue is:open label:bug repo:owner/repo')"),
      sort: z.enum(["comments", "reactions", "reactions-+1", "reactions--1", "interactions", "created", "updated"]).optional(),
      order: z.enum(["asc", "desc"]).optional().default("desc"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const resp = await client.octokit.rest.search.issuesAndPullRequests({
      q: params.query,
      sort: params.sort,
      order: params.order,
      per_page: params.per_page,
    });
    const items = resp.data.items as Record<string, unknown>[];
    return { content: [{ type: "text" as const, text: toonFormat({ total_count: resp.data.total_count, items }) }] };
  });

  server.registerTool("list_issues", {
    description: "List issues for a repository with filtering options",
    inputSchema: {
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
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const issues = await client.octokit.paginate(client.octokit.rest.issues.listForRepo, {
      owner,
      repo,
      state: params.state,
      labels: params.labels,
      assignee: params.assignee,
      milestone: params.milestone,
      sort: params.sort,
      direction: params.direction,
      per_page: params.per_page,
    });
    const filtered = issues.filter((i) => !(i as Record<string, unknown>).pull_request);
    return { content: [{ type: "text" as const, text: toonFormat(filtered) }] };
  });

  server.registerTool("get_issue", {
    description: "Get full issue details with body, labels, assignees, milestone",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      issue_number: z.number().describe("Issue number"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.issues.get({ owner, repo, issue_number: params.issue_number });
    return { content: [{ type: "text" as const, text: toonFormat(resp.data) }] };
  });

  if (isGateEnabled("write", config)) {
    server.registerTool("create_issue", {
      description: "Create a new issue",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        title: z.string().describe("Issue title"),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
        assignees: z.array(z.string()).optional(),
        milestone: z.number().optional(),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.issues.create({
        owner,
        repo,
        title: params.title,
        body: params.body,
        labels: params.labels,
        assignees: params.assignees,
        milestone: params.milestone,
      });
      return { content: [{ type: "text" as const, text: toonFormat(resp.data) }] };
    });

    server.registerTool("update_issue", {
      description: "Update an existing issue",
      inputSchema: {
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
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.issues.update({
        owner,
        repo,
        issue_number: params.issue_number,
        title: params.title,
        body: params.body,
        state: params.state,
        labels: params.labels,
        assignees: params.assignees,
        milestone: params.milestone ?? undefined,
      });
      return { content: [{ type: "text" as const, text: toonFormat(resp.data) }] };
    });

    server.registerTool("add_issue_comment", {
      description: "Add a comment to an issue",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        body: z.string().describe("Comment body (markdown)"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: params.issue_number,
        body: params.body,
      });
      return { content: [{ type: "text" as const, text: `Comment added: ${(resp.data as Record<string, unknown>).html_url}` }] };
    });

    server.registerTool("add_issue_labels", {
      description: "Add labels to an issue",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        labels: z.array(z.string()).describe("Labels to add"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: params.issue_number,
        labels: params.labels,
      });
      const names = (resp.data as Record<string, unknown>[]).map((l) => `\`${l.name}\``).join(", ");
      return { content: [{ type: "text" as const, text: `Labels on issue #${params.issue_number}: ${names}` }] };
    });

    server.registerTool("remove_issue_label", {
      description: "Remove a label from an issue",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        label: z.string().describe("Label name to remove"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      await client.octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: params.issue_number,
        name: params.label,
      });
      return { content: [{ type: "text" as const, text: `Label \`${params.label}\` removed from issue #${params.issue_number}.` }] };
    });

    server.registerTool("lock_issue", {
      description: "Lock an issue conversation",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        issue_number: z.number(),
        lock_reason: z.enum(["off-topic", "too heated", "resolved", "spam"]).optional(),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      await client.octokit.rest.issues.lock({
        owner,
        repo,
        issue_number: params.issue_number,
        lock_reason: params.lock_reason,
      });
      return { content: [{ type: "text" as const, text: `Issue #${params.issue_number} has been locked.` }] };
    });
  }

  server.registerTool("list_issue_comments", {
    description: "List comments on an issue",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      issue_number: z.number(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const comments = await client.octokit.paginate(client.octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: params.issue_number,
      per_page: params.per_page,
    });
    return { content: [{ type: "text" as const, text: toonFormat(comments) }] };
  });

  server.registerTool("list_milestones", {
    description: "List milestones for a repository",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      state: z.enum(["open", "closed", "all"]).optional().default("open"),
      sort: z.enum(["due_on", "completeness"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const milestones = await client.octokit.paginate(client.octokit.rest.issues.listMilestones, {
      owner,
      repo,
      state: params.state,
      sort: params.sort,
      direction: params.direction,
    });
    return { content: [{ type: "text" as const, text: toonFormat(milestones) }] };
  });
}
