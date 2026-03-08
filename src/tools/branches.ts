import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION, DESTRUCTIVE_ANNOTATION } from "./registry.js";
import { withDefaults } from "../utils/helpers.js";
import { formatBranch, formatBranchList } from "../utils/markdown.js";

export function registerBranchTools(server: McpServer, ctx: ToolContext): void {
  const { client, config, cache } = ctx;

  server.tool(
    "list_branches",
    "List branches for a repository with protection status",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      protected: z.boolean().optional().describe("Filter by protected status"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = new URLSearchParams();
      if (params.protected !== undefined) qs.set("protected", String(params.protected));
      qs.set("per_page", String(params.per_page));
      const branches = await client.paginate<Record<string, unknown>>(`/repos/${owner}/${repo}/branches?${qs}`, undefined, 3);
      return { content: [{ type: "text" as const, text: formatBranchList(branches) }] };
    }
  );

  server.tool(
    "get_branch",
    "Get branch details including protection rules",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      branch: z.string().describe("Branch name"),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const { data } = await client.cachedGet<Record<string, unknown>>(
        `/repos/${owner}/${repo}/branches/${params.branch}`,
        `branches:${owner}/${repo}:${params.branch}`, "branches"
      );
      return { content: [{ type: "text" as const, text: formatBranch(data) }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "create_branch",
      "Create a new branch from a ref",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().describe("New branch name"),
        from_ref: z.string().optional().describe("Source ref (SHA, branch, or tag). Defaults to default branch HEAD."),
      },
      WRITE_ANNOTATION,
      async (params) => {
        const { owner, repo } = withDefaults(params, config);

        let sha = params.from_ref;
        if (!sha || !sha.match(/^[0-9a-f]{40}$/i)) {
          const ref = params.from_ref || "HEAD";
          const refResp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/git/ref/heads/${ref === "HEAD" ? "" : ref}`).catch(async () => {
            const repoResp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}`);
            const defaultBranch = repoResp.data.default_branch as string;
            return client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`);
          });
          const obj = refResp.data.object as Record<string, unknown>;
          sha = obj.sha as string;
        }

        await client.post(`/repos/${owner}/${repo}/git/refs`, {
          ref: `refs/heads/${params.branch}`,
          sha,
        });
        cache.invalidatePrefix(`branches:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: `Branch \`${params.branch}\` created from \`${sha?.slice(0, 7)}\`` }] };
      }
    );
  }

  if (isGateEnabled("dangerous", config)) {
    server.tool(
      "delete_branch",
      "Delete a branch (DANGEROUS)",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().describe("Branch to delete"),
      },
      DESTRUCTIVE_ANNOTATION,
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        await client.delete(`/repos/${owner}/${repo}/git/refs/heads/${params.branch}`);
        cache.invalidatePrefix(`branches:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: `Branch \`${params.branch}\` deleted from ${owner}/${repo}.` }] };
      }
    );
  }

  server.tool(
    "get_branch_protection",
    "Get branch protection rule details",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      branch: z.string().describe("Branch name"),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      try {
        const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/branches/${params.branch}/protection`);
        const prot = resp.data;
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
    }
  );

  server.tool(
    "compare_branches",
    "Compare two branches/refs (ahead/behind count, diff stats, file list)",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      base: z.string().describe("Base ref (branch, tag, or SHA)"),
      head: z.string().describe("Head ref to compare"),
    },
    READ_ANNOTATION,
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/compare/${params.base}...${params.head}`);
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

      const files = data.files as Array<Record<string, unknown>> | undefined;
      if (files?.length) {
        lines.push("", "## Changed Files", "");
        lines.push("| File | Status | Changes |", "| --- | --- | --- |");
        for (const f of files) {
          lines.push(`| \`${f.filename}\` | ${f.status} | +${f.additions}/-${f.deletions} |`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
