import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled } from "./registry.js";
import { withDefaults, buildQueryString, formatDate } from "../utils/helpers.js";
import { formatPR, formatPRList, formatCommitList, formatCommentList } from "../utils/markdown.js";

export function registerPullRequestTools(server: McpServer, ctx: ToolContext): void {
  const { client, config, cache } = ctx;

  server.tool(
    "list_pull_requests",
    "List pull requests for a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      state: z.enum(["open", "closed", "all"]).optional().default("open"),
      head: z.string().optional().describe("Filter by head branch (user:branch)"),
      base: z.string().optional().describe("Filter by base branch"),
      sort: z.enum(["created", "updated", "popularity", "long-running"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = buildQueryString({
        state: params.state, head: params.head, base: params.base,
        sort: params.sort, direction: params.direction, per_page: params.per_page,
      });
      const prs = await client.paginate<Record<string, unknown>>(`/repos/${owner}/${repo}/pulls${qs}`, undefined, 3);
      return { content: [{ type: "text" as const, text: formatPRList(prs) }] };
    }
  );

  server.tool(
    "get_pull_request",
    "Get full PR details including body, diff stats, mergeable state",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.number().describe("PR number"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const cacheKey = `pulls:${owner}/${repo}:${params.pull_number}`;
      const cached = cache.get<Record<string, unknown>>(cacheKey);
      if (cached) return { content: [{ type: "text" as const, text: formatPR(cached.data) }] };

      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/pulls/${params.pull_number}`);
      cache.set(cacheKey, resp.data, "pulls", resp.etag);
      return { content: [{ type: "text" as const, text: formatPR(resp.data) }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "create_pull_request",
      "Create a new pull request",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        title: z.string(),
        body: z.string().optional(),
        head: z.string().describe("Branch with changes"),
        base: z.string().describe("Branch to merge into"),
        draft: z.boolean().optional().default(false),
      },
      async (params) => {
        const { owner, repo, ...body } = withDefaults(params, config);
        const resp = await client.post<Record<string, unknown>>(`/repos/${owner}/${repo}/pulls`, body);
        cache.invalidatePrefix(`pulls:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: formatPR(resp.data) }] };
      }
    );

    server.tool(
      "update_pull_request",
      "Update a pull request's title, body, or base branch",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.number(),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        base: z.string().optional(),
      },
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const { pull_number, ...body } = params;
        const resp = await client.patch<Record<string, unknown>>(`/repos/${owner}/${repo}/pulls/${pull_number}`, body);
        cache.invalidatePrefix(`pulls:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: formatPR(resp.data) }] };
      }
    );

    server.tool(
      "merge_pull_request",
      "Merge a pull request",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.number(),
        merge_method: z.enum(["merge", "squash", "rebase"]).optional().default("merge"),
        commit_title: z.string().optional(),
        commit_message: z.string().optional(),
      },
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const resp = await client.put<Record<string, unknown>>(
          `/repos/${owner}/${repo}/pulls/${params.pull_number}/merge`,
          {
            merge_method: params.merge_method,
            commit_title: params.commit_title,
            commit_message: params.commit_message,
          }
        );
        cache.invalidatePrefix(`pulls:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: `PR #${params.pull_number} merged via ${params.merge_method}.\nSHA: \`${resp.data.sha}\`\nMessage: ${resp.data.message}` }] };
      }
    );

    server.tool(
      "create_pr_review",
      "Submit a review on a pull request",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.number(),
        event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("Review action"),
        body: z.string().optional().describe("Review body"),
        comments: z.array(z.object({
          path: z.string(),
          position: z.number().optional(),
          line: z.number().optional(),
          body: z.string(),
        })).optional().describe("Inline comments"),
      },
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const resp = await client.post<Record<string, unknown>>(
          `/repos/${owner}/${repo}/pulls/${params.pull_number}/reviews`,
          { event: params.event, body: params.body, comments: params.comments }
        );
        return { content: [{ type: "text" as const, text: `Review submitted: ${params.event}\nURL: ${resp.data.html_url}` }] };
      }
    );

    server.tool(
      "request_reviewers",
      "Request reviewers for a pull request",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        pull_number: z.number(),
        reviewers: z.array(z.string()).optional().describe("User logins"),
        team_reviewers: z.array(z.string()).optional().describe("Team slugs"),
      },
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        await client.post(
          `/repos/${owner}/${repo}/pulls/${params.pull_number}/requested_reviewers`,
          { reviewers: params.reviewers, team_reviewers: params.team_reviewers }
        );
        const requested = [...(params.reviewers ?? []), ...(params.team_reviewers ?? [])].join(", ");
        return { content: [{ type: "text" as const, text: `Reviewers requested on PR #${params.pull_number}: ${requested}` }] };
      }
    );
  }

  server.tool(
    "list_pr_commits",
    "List commits in a pull request",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.number(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const commits = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/pulls/${params.pull_number}/commits?per_page=${params.per_page}`,
        undefined, 3
      );
      return { content: [{ type: "text" as const, text: formatCommitList(commits) }] };
    }
  );

  server.tool(
    "list_pr_files",
    "List changed files in a pull request with patch content",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.number(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const files = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/pulls/${params.pull_number}/files?per_page=${params.per_page}`,
        undefined, 5
      );
      if (files.length === 0) return { content: [{ type: "text" as const, text: "No files changed." }] };

      const lines = ["| File | Status | Changes |", "| --- | --- | --- |"];
      for (const f of files) {
        lines.push(`| \`${f.filename}\` | ${f.status} | +${f.additions}/-${f.deletions} |`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "get_pr_diff",
    "Get the full unified diff of a pull request (critical for code review)",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.number(),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const response = await client.getRaw(
        `/repos/${owner}/${repo}/pulls/${params.pull_number}`,
        { headers: { Accept: "application/vnd.github.v3.diff" } }
      );
      const diff = await response.text();
      return { content: [{ type: "text" as const, text: `\`\`\`diff\n${diff}\n\`\`\`` }] };
    }
  );

  server.tool(
    "list_pr_reviews",
    "List reviews on a pull request",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.number(),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const reviews = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/pulls/${params.pull_number}/reviews`,
        undefined, 3
      );
      if (reviews.length === 0) return { content: [{ type: "text" as const, text: "No reviews yet." }] };

      const lines = ["| Reviewer | State | Submitted |", "| --- | --- | --- |"];
      for (const r of reviews) {
        lines.push(
          `| @${(r.user as Record<string, unknown>)?.login ?? "?"} | **${r.state}** | ${formatDate(r.submitted_at as string)} |`
        );
      }
      if (reviews.some((r) => r.body)) {
        lines.push("", "---", "");
        for (const r of reviews) {
          if (r.body) {
            lines.push(`**@${(r.user as Record<string, unknown>)?.login}** (${r.state}):`, "", r.body as string, "");
          }
        }
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "list_pr_review_comments",
    "List inline review comments on a pull request",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.number(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const comments = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/pulls/${params.pull_number}/comments?per_page=${params.per_page}`,
        undefined, 3
      );
      if (comments.length === 0) return { content: [{ type: "text" as const, text: "No review comments." }] };

      const lines: string[] = [];
      for (const c of comments) {
        lines.push(
          `**@${(c.user as Record<string, unknown>)?.login}** on \`${c.path}\` (line ${c.line ?? c.original_line ?? "?"}):`,
          "",
          c.body as string,
          "",
          "---",
          ""
        );
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "list_pr_checks",
    "List check runs and commit status for a PR's head commit",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      pull_number: z.number(),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const pr = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/pulls/${params.pull_number}`);
      const head = pr.data.head as Record<string, unknown>;
      const sha = head.sha as string;

      const [checksResp, statusResp] = await Promise.all([
        client.get<{ total_count: number; check_runs: Array<Record<string, unknown>> }>(`/repos/${owner}/${repo}/commits/${sha}/check-runs`),
        client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/commits/${sha}/status`),
      ]);

      const lines = [`# Checks for PR #${params.pull_number} (${sha.slice(0, 7)})`, ""];

      const checks = checksResp.data.check_runs;
      if (checks.length > 0) {
        lines.push("## Check Runs", "", "| Name | Status | Conclusion | URL |", "| --- | --- | --- | --- |");
        for (const c of checks) {
          lines.push(`| ${c.name} | ${c.status} | ${c.conclusion ?? "pending"} | ${c.html_url ?? "-"} |`);
        }
      }

      const statuses = statusResp.data.statuses as Array<Record<string, unknown>> | undefined;
      if (statuses?.length) {
        lines.push("", "## Commit Statuses", "", "| Context | State | Description |", "| --- | --- | --- |");
        for (const s of statuses) {
          lines.push(`| ${s.context} | ${s.state} | ${s.description ?? "-"} |`);
        }
      }

      if (checks.length === 0 && (!statuses || statuses.length === 0)) {
        lines.push("No checks or statuses found.");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
