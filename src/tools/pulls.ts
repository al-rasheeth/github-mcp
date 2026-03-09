import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { withDefaults } from "../utils/helpers.js";
import { content } from "../utils/toon.js";

export function registerPullRequestTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("list_pull_requests", {
    description: "List pull requests for a repository",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      state: z.enum(["open", "closed", "all"]).optional().default("open"),
      head: z.string().optional().describe("Filter by head branch (user:branch)"),
      base: z.string().optional().describe("Filter by base branch"),
      sort: z.enum(["created", "updated", "popularity", "long-running"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
      per_page: z.coerce.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const prs = await client.octokit.paginate(client.octokit.rest.pulls.list, {
      owner,
      repo,
      state: params.state,
      head: params.head,
      base: params.base,
      sort: params.sort,
      direction: params.direction,
      per_page: params.per_page,
    });
    return content(prs);
  });

  server.registerTool("get_pull_request", {
    description: "Get full PR details including body, diff stats, mergeable state",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.coerce.number().describe("PR number"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.pulls.get({ owner, repo, pull_number: params.pull_number });
    return content(resp.data);
  });

  if (isGateEnabled("write", config)) {
    server.registerTool("create_pull_request", {
      description: "Create a new pull request",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        title: z.string(),
        body: z.string().optional(),
        head: z.string().describe("Branch with changes"),
        base: z.string().describe("Branch to merge into"),
        draft: z.coerce.boolean().optional().default(false),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.pulls.create({
        owner,
        repo,
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
        draft: params.draft,
      });
      return content(resp.data);
    });

    server.registerTool("update_pull_request", {
      description: "Update a pull request's title, body, or base branch",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.coerce.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        base: z.string().optional(),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const { pull_number, title, body, state, base } = params;
      const resp = await client.octokit.rest.pulls.update({
        owner,
        repo,
        pull_number,
        title,
        body,
        state,
        base,
      });
      return content(resp.data);
    });

    server.registerTool("merge_pull_request", {
      description: "Merge a pull request",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.coerce.number(),
        merge_method: z.enum(["merge", "squash", "rebase"]).optional().default("merge"),
        commit_title: z.string().optional(),
        commit_message: z.string().optional(),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: params.pull_number,
        merge_method: params.merge_method,
        commit_title: params.commit_title,
        commit_message: params.commit_message,
      });
      return content({ pull_number: params.pull_number, merge_method: params.merge_method, sha: resp.data.sha, message: resp.data.message });
    });

    server.registerTool("create_pr_review", {
      description: "Submit a review on a pull request",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.coerce.number(),
        event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("Review action"),
        body: z.string().optional().describe("Review body"),
        comments: z.array(z.object({
          path: z.string(),
          position: z.coerce.number().optional(),
          line: z.coerce.number().optional(),
          body: z.string(),
        })).optional().describe("Inline comments"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: params.pull_number,
        event: params.event,
        body: params.body,
        comments: params.comments,
      });
      return content({ event: params.event, url: (resp.data as Record<string, unknown>).html_url });
    });

    server.registerTool("request_reviewers", {
      description: "Request reviewers for a pull request",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.coerce.number(),
        reviewers: z.array(z.string()).optional().describe("User logins"),
        team_reviewers: z.array(z.string()).optional().describe("Team slugs"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      await client.octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: params.pull_number,
        reviewers: params.reviewers,
        team_reviewers: params.team_reviewers,
      });
      const requested = [...(params.reviewers ?? []), ...(params.team_reviewers ?? [])].join(", ");
      return content({ pull_number: params.pull_number, reviewers: requested });
    });
  }

  server.registerTool("list_pr_commits", {
    description: "List commits in a pull request",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.coerce.number(),
      per_page: z.coerce.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const commits = await client.octokit.paginate(client.octokit.rest.pulls.listCommits, {
      owner,
      repo,
      pull_number: params.pull_number,
      per_page: params.per_page,
    });
    return content(commits);
  });

  server.registerTool("list_pr_files", {
    description: "List changed files in a pull request with patch content",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.coerce.number(),
      per_page: z.coerce.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const files = await client.octokit.paginate(client.octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: params.pull_number,
      per_page: params.per_page,
    });
    if (files.length === 0) return content({ files: [] });

    const lines = ["| File | Status | Changes |", "| --- | --- | --- |"];
    for (const f of files as Record<string, unknown>[]) {
      lines.push(`| \`${f.filename}\` | ${f.status} | +${f.additions}/-${f.deletions} |`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("get_pr_diff", {
    description: "Get the full unified diff of a pull request (critical for code review)",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.coerce.number(),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const response = await client.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: params.pull_number,
      mediaType: { format: "diff" },
    });
    const diff = response.data as unknown as string;
    return content({ diff });
  });

  server.registerTool("list_pr_reviews", {
    description: "List reviews on a pull request",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.coerce.number(),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const reviews = await client.octokit.paginate(client.octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: params.pull_number,
    });
    if (reviews.length === 0) return content({ reviews: [] });
    return content(reviews);
  });

  server.registerTool("list_pr_review_comments", {
    description: "List inline review comments on a pull request",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.coerce.number(),
      per_page: z.coerce.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const comments = await client.octokit.paginate(client.octokit.rest.pulls.listReviewComments, {
      owner,
      repo,
      pull_number: params.pull_number,
      per_page: params.per_page,
    });
    if (comments.length === 0) return content({ comments: [] });
    return content(comments);
  });

  server.registerTool("list_pr_checks", {
    description: "List check runs and commit status for a PR's head commit",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.coerce.number(),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const pr = await client.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: params.pull_number,
    });
    const head = pr.data.head as Record<string, unknown>;
    const sha = head.sha as string;

    const [checksResp, statusResp] = await Promise.all([
      client.octokit.rest.checks.listForRef({ owner, repo, ref: sha }),
      client.octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha }),
    ]);

    const data = {
      pull_number: params.pull_number,
      head_sha: sha.slice(0, 7),
      check_runs: checksResp.data.check_runs,
      statuses: statusResp.data.statuses,
    };
    return content(data);
  });
}
