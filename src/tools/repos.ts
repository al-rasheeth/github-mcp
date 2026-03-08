import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled } from "./registry.js";
import { withDefaults, withOwnerDefault, decodeBase64, buildQueryString } from "../utils/helpers.js";
import { formatRepo, formatRepoList } from "../utils/markdown.js";

export function registerRepoTools(server: McpServer, ctx: ToolContext): void {
  const { client, config, cache } = ctx;

  server.tool(
    "list_repos",
    "List repositories for the authenticated user or a specified org/user",
    {
      owner: z.string().optional().describe("User or org (omit for authenticated user's repos)"),
      type: z.enum(["all", "owner", "public", "private", "member"]).optional().describe("Filter by type"),
      sort: z.enum(["created", "updated", "pushed", "full_name"]).optional().describe("Sort field"),
      direction: z.enum(["asc", "desc"]).optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const qs = buildQueryString({ type: params.type, sort: params.sort, direction: params.direction, per_page: params.per_page });
      const path = params.owner ? `/users/${params.owner}/repos${qs}` : `/user/repos${qs}`;
      const repos = await client.paginate<Record<string, unknown>>(path, undefined, 3);
      return { content: [{ type: "text" as const, text: formatRepoList(repos) }] };
    }
  );

  server.tool(
    "get_repo",
    "Get full details for a repository",
    {
      owner: z.string().optional().describe("Repository owner"),
      repo: z.string().optional().describe("Repository name"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const cacheKey = `repos:${owner}/${repo}`;
      const cached = cache.get<Record<string, unknown>>(cacheKey);
      if (cached) return { content: [{ type: "text" as const, text: formatRepo(cached.data) }] };

      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}`);
      cache.set(cacheKey, resp.data, "repos", resp.etag);
      return { content: [{ type: "text" as const, text: formatRepo(resp.data) }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "create_repo",
      "Create a new repository",
      {
        name: z.string().describe("Repository name"),
        description: z.string().optional(),
        private: z.boolean().optional().default(false),
        auto_init: z.boolean().optional().default(false),
        gitignore_template: z.string().optional(),
        license_template: z.string().optional(),
        org: z.string().optional().describe("Create under this org instead of user"),
      },
      async (params) => {
        const path = params.org ? `/orgs/${params.org}/repos` : "/user/repos";
        const resp = await client.post<Record<string, unknown>>(path, params);
        cache.invalidatePrefix("repos:");
        return { content: [{ type: "text" as const, text: formatRepo(resp.data) }] };
      }
    );

    server.tool(
      "update_repo",
      "Update repository settings",
      {
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
      async (params) => {
        const { owner, repo, ...body } = withDefaults(params, config);
        const resp = await client.patch<Record<string, unknown>>(`/repos/${owner}/${repo}`, body);
        cache.invalidatePrefix(`repos:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: formatRepo(resp.data) }] };
      }
    );
  }

  if (isGateEnabled("dangerous", config)) {
    server.tool(
      "delete_repo",
      "Delete a repository (DANGEROUS - irreversible)",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        confirm: z.boolean().describe("Must be true to confirm deletion"),
      },
      async (params) => {
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text: "Deletion not confirmed. Set `confirm: true` to proceed." }] };
        }
        const { owner, repo } = withDefaults(params, config);
        await client.delete(`/repos/${owner}/${repo}`);
        cache.invalidatePrefix(`repos:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: `Repository ${owner}/${repo} has been deleted.` }] };
      }
    );
  }

  server.tool(
    "list_repo_topics",
    "Get topics/tags for a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<{ names: string[] }>(`/repos/${owner}/${repo}/topics`);
      const topics = resp.data.names;
      if (topics.length === 0) return { content: [{ type: "text" as const, text: "No topics set." }] };
      return { content: [{ type: "text" as const, text: `**Topics:** ${topics.map((t) => `\`${t}\``).join(", ")}` }] };
    }
  );

  server.tool(
    "list_languages",
    "Get language breakdown for a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<Record<string, number>>(`/repos/${owner}/${repo}/languages`);
      const total = Object.values(resp.data).reduce((a, b) => a + b, 0);
      if (total === 0) return { content: [{ type: "text" as const, text: "No language data available." }] };

      const lines = ["| Language | Bytes | Percentage |", "| --- | --- | --- |"];
      for (const [lang, bytes] of Object.entries(resp.data)) {
        const pct = ((bytes / total) * 100).toFixed(1);
        lines.push(`| ${lang} | ${bytes.toLocaleString()} | ${pct}% |`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "list_contributors",
    "List contributors with commit counts",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<Array<Record<string, unknown>>>(`/repos/${owner}/${repo}/contributors?per_page=${params.per_page}`);
      if (!Array.isArray(resp.data) || resp.data.length === 0) {
        return { content: [{ type: "text" as const, text: "No contributors found." }] };
      }
      const lines = ["| Contributor | Contributions |", "| --- | --- |"];
      for (const c of resp.data) {
        lines.push(`| @${c.login} | ${c.contributions} |`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "get_readme",
    "Fetch and return the README content of a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      ref: z.string().optional().describe("Branch/tag/commit to read from"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = params.ref ? `?ref=${params.ref}` : "";
      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/readme${qs}`);
      const content = decodeBase64(resp.data.content as string);
      return { content: [{ type: "text" as const, text: content }] };
    }
  );

  server.tool(
    "get_file_contents",
    "Read any file from a repository at a given ref",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      path: z.string().describe("File path in the repo"),
      ref: z.string().optional().describe("Branch/tag/commit"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = params.ref ? `?ref=${params.ref}` : "";
      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/contents/${params.path}${qs}`);

      if (Array.isArray(resp.data)) {
        const lines = ["| Name | Type | Size |", "| --- | --- | --- |"];
        for (const item of resp.data as Array<Record<string, unknown>>) {
          lines.push(`| \`${item.name}\` | ${item.type} | ${item.size ?? "-"} |`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      const data = resp.data;
      if (data.type === "file" && data.content) {
        const content = decodeBase64(data.content as string);
        return { content: [{ type: "text" as const, text: `## \`${params.path}\`\n\n\`\`\`\n${content}\n\`\`\`` }] };
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "create_or_update_file",
      "Create or update a file in a repository via the API",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        path: z.string().describe("File path"),
        content: z.string().describe("File content (will be base64 encoded)"),
        message: z.string().describe("Commit message"),
        branch: z.string().optional(),
        sha: z.string().optional().describe("SHA of file being replaced (required for updates)"),
      },
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const body: Record<string, unknown> = {
          message: params.message,
          content: Buffer.from(params.content).toString("base64"),
        };
        if (params.branch) body.branch = params.branch;
        if (params.sha) body.sha = params.sha;
        const resp = await client.put<Record<string, unknown>>(`/repos/${owner}/${repo}/contents/${params.path}`, body);
        cache.invalidatePrefix(`repos:${owner}/${repo}`);
        const commit = resp.data.commit as Record<string, unknown>;
        return { content: [{ type: "text" as const, text: `File committed: \`${params.path}\`\nSHA: \`${commit?.sha}\`\nMessage: ${params.message}` }] };
      }
    );
  }
}
