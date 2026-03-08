import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION, DESTRUCTIVE_ANNOTATION } from "./registry.js";
import { withDefaults, decodeBase64 } from "../utils/helpers.js";
import { formatRepo, formatRepoList } from "../utils/markdown.js";

export function registerRepoTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("list_repos", {
    description: "List repositories for the authenticated user or a specified org/user",
    inputSchema: {
      owner: z.string().optional().describe("User or org (omit for authenticated user's repos)"),
      type: z.enum(["all", "owner", "public", "private", "member"]).optional().describe("Filter by type"),
      sort: z.enum(["created", "updated", "pushed", "full_name"]).optional().describe("Sort field"),
      direction: z.enum(["asc", "desc"]).optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    let repos;
    if (params.owner) {
      repos = await client.octokit.paginate(client.octokit.rest.repos.listForUser, {
        username: params.owner, type: params.type as "all" | "owner" | "member" | undefined, sort: params.sort, direction: params.direction, per_page: params.per_page,
      });
    } else {
      repos = await client.octokit.paginate(client.octokit.rest.repos.listForAuthenticatedUser, {
        type: params.type as "all" | "owner" | "public" | "private" | "member" | undefined, sort: params.sort, direction: params.direction, per_page: params.per_page,
      });
    }
    return { content: [{ type: "text" as const, text: formatRepoList(repos as Record<string, unknown>[]) }] };
  });

  server.registerTool("get_repo", {
    description: "Get full details for a repository",
    inputSchema: {
      owner: z.string().optional().describe("Repository owner"),
      repo: z.string().optional().describe("Repository name"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.repos.get({ owner, repo });
    return { content: [{ type: "text" as const, text: formatRepo(resp.data as Record<string, unknown>) }] };
  });

  if (isGateEnabled("write", config)) {
    server.registerTool("create_repo", {
      description: "Create a new repository",
      inputSchema: {
        name: z.string().describe("Repository name"),
        description: z.string().optional(),
        private: z.boolean().optional().default(false),
        auto_init: z.boolean().optional().default(false),
        gitignore_template: z.string().optional(),
        license_template: z.string().optional(),
        org: z.string().optional().describe("Create under this org instead of user"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      let data;
      if (params.org) {
        const resp = await client.octokit.rest.repos.createInOrg({ org: params.org, name: params.name, description: params.description, private: params.private, auto_init: params.auto_init, gitignore_template: params.gitignore_template, license_template: params.license_template });
        data = resp.data;
      } else {
        const resp = await client.octokit.rest.repos.createForAuthenticatedUser({ name: params.name, description: params.description, private: params.private, auto_init: params.auto_init, gitignore_template: params.gitignore_template, license_template: params.license_template });
        data = resp.data;
      }
      return { content: [{ type: "text" as const, text: formatRepo(data as Record<string, unknown>) }] };
    });

    server.registerTool("update_repo", {
      description: "Update repository settings",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        description: z.string().optional(),
        homepage: z.string().optional(),
        private: z.boolean().optional(),
        has_issues: z.boolean().optional(),
        has_projects: z.boolean().optional(),
        has_wiki: z.boolean().optional(),
        default_branch: z.string().optional(),
        archived: z.boolean().optional(),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.repos.update({ owner, repo, description: params.description, homepage: params.homepage, private: params.private, has_issues: params.has_issues, has_projects: params.has_projects, has_wiki: params.has_wiki, default_branch: params.default_branch, archived: params.archived });
      return { content: [{ type: "text" as const, text: formatRepo(resp.data as Record<string, unknown>) }] };
    });

    server.registerTool("create_or_update_file", {
      description: "Create or update a file in a repository via the API",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        path: z.string().describe("File path"),
        content: z.string().describe("File content (will be base64 encoded)"),
        message: z.string().describe("Commit message"),
        branch: z.string().optional(),
        sha: z.string().optional().describe("SHA of file being replaced (required for updates)"),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.octokit.rest.repos.createOrUpdateFileContents({
        owner, repo, path: params.path, message: params.message,
        content: Buffer.from(params.content).toString("base64"),
        branch: params.branch, sha: params.sha,
      });
      return { content: [{ type: "text" as const, text: `File committed: \`${params.path}\`\nSHA: \`${resp.data.commit.sha}\`\nMessage: ${params.message}` }] };
    });
  }

  if (isGateEnabled("dangerous", config)) {
    server.registerTool("delete_repo", {
      description: "Delete a repository (DANGEROUS - irreversible)",
      inputSchema: {
        owner: z.string().optional(),
        repo: z.string().optional(),
        confirm: z.boolean().describe("Must be true to confirm deletion"),
      },
      annotations: DESTRUCTIVE_ANNOTATION,
    }, async (params) => {
      if (!params.confirm) return { content: [{ type: "text" as const, text: "Deletion not confirmed. Set `confirm: true` to proceed." }] };
      const { owner, repo } = withDefaults(params, config);
      await client.octokit.rest.repos.delete({ owner, repo });
      return { content: [{ type: "text" as const, text: `Repository ${owner}/${repo} has been deleted.` }] };
    });
  }

  server.registerTool("list_repo_topics", {
    description: "Get topics/tags for a repository",
    inputSchema: { owner: z.string().optional(), repo: z.string().optional() },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.repos.getAllTopics({ owner, repo });
    const topics = resp.data.names;
    if (topics.length === 0) return { content: [{ type: "text" as const, text: "No topics set." }] };
    return { content: [{ type: "text" as const, text: `**Topics:** ${topics.map((t) => `\`${t}\``).join(", ")}` }] };
  });

  server.registerTool("list_languages", {
    description: "Get language breakdown for a repository",
    inputSchema: { owner: z.string().optional(), repo: z.string().optional() },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.repos.listLanguages({ owner, repo });
    const total = Object.values(resp.data).reduce((a, b) => a + b, 0);
    if (total === 0) return { content: [{ type: "text" as const, text: "No language data available." }] };
    const lines = ["| Language | Bytes | Percentage |", "| --- | --- | --- |"];
    for (const [lang, bytes] of Object.entries(resp.data)) {
      lines.push(`| ${lang} | ${bytes.toLocaleString()} | ${((bytes / total) * 100).toFixed(1)}% |`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("list_contributors", {
    description: "List contributors with commit counts",
    inputSchema: { owner: z.string().optional(), repo: z.string().optional(), per_page: z.number().min(1).max(100).optional().default(30) },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.repos.listContributors({ owner, repo, per_page: params.per_page });
    if (!resp.data.length) return { content: [{ type: "text" as const, text: "No contributors found." }] };
    const lines = ["| Contributor | Contributions |", "| --- | --- |"];
    for (const c of resp.data) { lines.push(`| @${c.login} | ${c.contributions} |`); }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("get_readme", {
    description: "Fetch and return the README content of a repository",
    inputSchema: { owner: z.string().optional(), repo: z.string().optional(), ref: z.string().optional().describe("Branch/tag/commit") },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.repos.getReadme({ owner, repo, ref: params.ref });
    const content = decodeBase64((resp.data as unknown as { content: string }).content);
    return { content: [{ type: "text" as const, text: content }] };
  });

  server.registerTool("get_file_contents", {
    description: "Read any file from a repository at a given ref",
    inputSchema: { owner: z.string().optional(), repo: z.string().optional(), path: z.string().describe("File path"), ref: z.string().optional().describe("Branch/tag/commit") },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const resp = await client.octokit.rest.repos.getContent({ owner, repo, path: params.path, ref: params.ref });
    const data = resp.data;
    if (Array.isArray(data)) {
      const lines = ["| Name | Type | Size |", "| --- | --- | --- |"];
      for (const item of data) { lines.push(`| \`${item.name}\` | ${item.type} | ${item.size ?? "-"} |`); }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
    if (data.type === "file" && "content" in data && data.content) {
      const decoded = decodeBase64(data.content);
      return { content: [{ type: "text" as const, text: `## \`${params.path}\`\n\n\`\`\`\n${decoded}\n\`\`\`` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  });
}
