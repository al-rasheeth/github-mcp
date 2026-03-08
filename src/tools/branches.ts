import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION, DESTRUCTIVE_ANNOTATION } from "./registry.js";
import { withDefaults } from "../utils/helpers.js";
import { formatBranch, formatBranchList } from "../utils/markdown.js";

export function registerBranchTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("list_branches", {
    description: "List branches for a repository with protection status",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      protected: z.boolean().optional().describe("Filter by protected status"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const branches = await client.octokit.paginate(client.octokit.rest.repos.listBranches, {
      owner,
      repo,
      protected: params.protected,
      per_page: params.per_page,
    });
    return { content: [{ type: "text" as const, text: formatBranchList(branches as Record<string, unknown>[]) }] };
  });

  server.registerTool("get_branch", {
    description: "Get branch details including protection rules",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      branch: z.string().describe("Branch name"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.repos.getBranch({ owner, repo, branch: params.branch });
    return { content: [{ type: "text" as const, text: formatBranch(resp.data as Record<string, unknown>) }] };
  });

  if (isGateEnabled("write", config)) {
    server.registerTool("create_branch", {
      description: "Create a new branch from a ref",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().describe("New branch name"),
        from_ref: z.string().optional().describe("Source ref (SHA, branch, or tag). Defaults to default branch HEAD."),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);

      let sha = params.from_ref;
      if (!sha || !sha.match(/^[0-9a-f]{40}$/i)) {
        const ref = params.from_ref || "HEAD";
        try {
          if (ref === "HEAD") {
            const repoResp = await client.octokit.rest.repos.get({ owner, repo });
            const defaultBranch = repoResp.data.default_branch;
            const refResp = await client.octokit.rest.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` });
            sha = refResp.data.object.sha;
          } else {
            const refResp = await client.octokit.rest.git.getRef({ owner, repo, ref: `heads/${ref}` });
            sha = refResp.data.object.sha;
          }
        } catch {
          const repoResp = await client.octokit.rest.repos.get({ owner, repo });
          const defaultBranch = repoResp.data.default_branch;
          const refResp = await client.octokit.rest.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` });
          sha = refResp.data.object.sha;
        }
      }

      await client.octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${params.branch}`,
        sha: sha!,
      });
      return { content: [{ type: "text" as const, text: `Branch \`${params.branch}\` created from \`${sha?.slice(0, 7)}\`` }] };
    });
  }

  if (isGateEnabled("dangerous", config)) {
    server.registerTool("delete_branch", {
      description: "Delete a branch (DANGEROUS)",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().describe("Branch to delete"),
      },
      annotations: DESTRUCTIVE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      await client.octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${params.branch}` });
      return { content: [{ type: "text" as const, text: `Branch \`${params.branch}\` deleted from ${owner}/${repo}.` }] };
    });
  }

  server.registerTool("get_branch_protection", {
    description: "Get branch protection rule details",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      branch: z.string().describe("Branch name"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    try {
      const resp = await client.octokit.rest.repos.getBranchProtection({ owner, repo, branch: params.branch });
      const prot = resp.data as Record<string, unknown>;

      const lines = [
        `# Branch Protection: \`${params.branch}\``,
        "",
        "| Rule | Value |",
        "| --- | --- |",
      ];

      const reqReviews = prot.required_pull_request_reviews as Record<string, unknown> | undefined;
      if (reqReviews) {
        lines.push(`| **Required reviews** | ${reqReviews.required_approving_review_count ?? "Yes"} |`);
        lines.push(`| **Dismiss stale reviews** | ${reqReviews.dismiss_stale_reviews ?? false} |`);
      }
      const reqChecks = prot.required_status_checks as Record<string, unknown> | undefined;
      if (reqChecks) {
        lines.push(`| **Strict status checks** | ${reqChecks.strict ?? false} |`);
        const contexts = reqChecks.contexts as string[] | undefined;
        if (contexts?.length) lines.push(`| **Required checks** | ${contexts.join(", ")} |`);
      }
      lines.push(`| **Enforce admins** | ${(prot.enforce_admins as Record<string, unknown>)?.enabled ?? false} |`);
      lines.push(`| **Allow force pushes** | ${(prot.allow_force_pushes as Record<string, unknown>)?.enabled ?? false} |`);
      lines.push(`| **Allow deletions** | ${(prot.allow_deletions as Record<string, unknown>)?.enabled ?? false} |`);

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch {
      return { content: [{ type: "text" as const, text: `Branch \`${params.branch}\` has no protection rules configured.` }] };
    }
  });

  server.registerTool("compare_branches", {
    description: "Compare two branches/refs (ahead/behind count, diff stats, file list)",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      base: z.string().describe("Base ref (branch, tag, or SHA)"),
      head: z.string().describe("Head ref to compare"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.repos.compareCommits({
      owner,
      repo,
      base: params.base,
      head: params.head,
    });
    const data = resp.data as Record<string, unknown>;

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

    const files = data.files as Array<Record<string, unknown>> | undefined;
    if (files?.length) {
      lines.push("", "## Changed Files", "");
      lines.push("| File | Status | Changes |", "| --- | --- | --- |");
      for (const f of files) {
        lines.push(`| \`${f.filename}\` | ${f.status} | +${f.additions}/-${f.deletions} |`);
      }
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });
}
