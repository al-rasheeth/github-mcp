import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { withDefaults, formatDate } from "../utils/helpers.js";
import { formatRelease } from "../utils/markdown.js";

export function registerReleaseTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("list_releases", {
    description: "List releases for a repository",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const releases = await client.octokit.paginate(client.octokit.rest.repos.listReleases, {
      owner,
      repo,
      per_page: params.per_page,
    });
    if (releases.length === 0) return { content: [{ type: "text" as const, text: "No releases found." }] };

    const lines = ["| Tag | Name | Prerelease | Published |", "| --- | --- | --- | --- |"];
    for (const r of releases as Record<string, unknown>[]) {
      lines.push(
        `| \`${r.tag_name}\` | ${r.name || "-"} | ${r.prerelease ? "Yes" : "No"} | ${formatDate(r.published_at as string)} |`
      );
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("get_release", {
    description: "Get release details with assets",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      release_id: z.number().optional().describe("Release ID"),
      tag: z.string().optional().describe("Tag name (alternative to release_id)"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    let data;
    if (params.tag) {
      const resp = await client.octokit.rest.repos.getReleaseByTag({ owner, repo, tag: params.tag });
      data = resp.data;
    } else if (params.release_id) {
      const resp = await client.octokit.rest.repos.getRelease({ owner, repo, release_id: params.release_id });
      data = resp.data;
    } else {
      const resp = await client.octokit.rest.repos.getLatestRelease({ owner, repo });
      data = resp.data;
    }
    return { content: [{ type: "text" as const, text: formatRelease(data as Record<string, unknown>) }] };
  });

  if (isGateEnabled("write", config)) {
    server.registerTool("create_release", {
      description: "Create a new release",
      inputSchema: {
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
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo, ...rest } = withDefaults(params, config);
      const { data } = await client.octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name: params.tag_name,
        name: params.name,
        body: params.body,
        draft: params.draft,
        prerelease: params.prerelease,
        target_commitish: params.target_commitish,
        generate_release_notes: params.generate_release_notes,
      });
      return { content: [{ type: "text" as const, text: formatRelease(data as Record<string, unknown>) }] };
    });
  }

  server.registerTool("list_tags", {
    description: "List tags for a repository",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const tags = await client.octokit.paginate(client.octokit.rest.repos.listTags, {
      owner,
      repo,
      per_page: params.per_page,
    });
    if (tags.length === 0) return { content: [{ type: "text" as const, text: "No tags found." }] };

    const lines = ["| Tag | SHA |", "| --- | --- |"];
    for (const t of tags as Record<string, unknown>[]) {
      const commit = t.commit as Record<string, unknown>;
      lines.push(`| \`${t.name}\` | \`${(commit?.sha as string)?.slice(0, 7)}\` |`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  server.registerTool("generate_release_notes", {
    description: "Generate release notes using GitHub's auto-generated release notes API",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      tag_name: z.string().describe("Tag for the release"),
      target_commitish: z.string().optional(),
      previous_tag_name: z.string().optional().describe("Previous tag to compare from"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.repos.generateReleaseNotes({
      owner,
      repo,
      tag_name: params.tag_name,
      target_commitish: params.target_commitish,
      previous_tag_name: params.previous_tag_name,
    });
    return { content: [{ type: "text" as const, text: `# ${data.name}\n\n${data.body}` }] };
  });
}
