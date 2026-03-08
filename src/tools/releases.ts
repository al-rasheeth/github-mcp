import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled } from "./registry.js";
import { withDefaults, buildQueryString, formatDate } from "../utils/helpers.js";
import { formatRelease } from "../utils/markdown.js";

export function registerReleaseTools(server: McpServer, ctx: ToolContext): void {
  const { client, config, cache } = ctx;

  server.tool(
    "list_releases",
    "List releases for a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const releases = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/releases?per_page=${params.per_page}`, undefined, 3
      );
      if (releases.length === 0) return { content: [{ type: "text" as const, text: "No releases found." }] };

      const lines = ["| Tag | Name | Prerelease | Published |", "| --- | --- | --- | --- |"];
      for (const r of releases) {
        lines.push(
          `| \`${r.tag_name}\` | ${r.name || "-"} | ${r.prerelease ? "Yes" : "No"} | ${formatDate(r.published_at as string)} |`
        );
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "get_release",
    "Get release details with assets",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      release_id: z.number().optional().describe("Release ID"),
      tag: z.string().optional().describe("Tag name (alternative to release_id)"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      let path: string;
      if (params.tag) {
        path = `/repos/${owner}/${repo}/releases/tags/${params.tag}`;
      } else if (params.release_id) {
        path = `/repos/${owner}/${repo}/releases/${params.release_id}`;
      } else {
        path = `/repos/${owner}/${repo}/releases/latest`;
      }

      const cacheKey = `releases:${owner}/${repo}:${params.tag ?? params.release_id ?? "latest"}`;
      const cached = cache.get<Record<string, unknown>>(cacheKey);
      if (cached) return { content: [{ type: "text" as const, text: formatRelease(cached.data) }] };

      const resp = await client.get<Record<string, unknown>>(path);
      cache.set(cacheKey, resp.data, "releases", resp.etag);
      return { content: [{ type: "text" as const, text: formatRelease(resp.data) }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "create_release",
      "Create a new release",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        tag_name: z.string().describe("Tag for the release"),
        name: z.string().optional(),
        body: z.string().optional().describe("Release notes (markdown)"),
        draft: z.boolean().optional().default(false),
        prerelease: z.boolean().optional().default(false),
        target_commitish: z.string().optional().describe("Branch or commit SHA"),
        generate_release_notes: z.boolean().optional().default(false),
      },
      async (params) => {
        const { owner, repo, ...body } = withDefaults(params, config);
        const resp = await client.post<Record<string, unknown>>(`/repos/${owner}/${repo}/releases`, body);
        cache.invalidatePrefix(`releases:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: formatRelease(resp.data) }] };
      }
    );
  }

  server.tool(
    "list_tags",
    "List tags for a repository",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const tags = await client.paginate<Record<string, unknown>>(
        `/repos/${owner}/${repo}/tags?per_page=${params.per_page}`, undefined, 3
      );
      if (tags.length === 0) return { content: [{ type: "text" as const, text: "No tags found." }] };

      const lines = ["| Tag | SHA |", "| --- | --- |"];
      for (const t of tags) {
        const commit = t.commit as Record<string, unknown>;
        lines.push(`| \`${t.name}\` | \`${(commit?.sha as string)?.slice(0, 7)}\` |`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "generate_release_notes",
    "Generate release notes using GitHub's auto-generated release notes API",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      tag_name: z.string().describe("Tag for the release"),
      target_commitish: z.string().optional(),
      previous_tag_name: z.string().optional().describe("Previous tag to compare from"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.post<{ name: string; body: string }>(
        `/repos/${owner}/${repo}/releases/generate-notes`,
        {
          tag_name: params.tag_name,
          target_commitish: params.target_commitish,
          previous_tag_name: params.previous_tag_name,
        }
      );
      return { content: [{ type: "text" as const, text: `# ${resp.data.name}\n\n${resp.data.body}` }] };
    }
  );
}
