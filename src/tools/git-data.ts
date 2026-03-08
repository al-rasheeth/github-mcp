import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled } from "./registry.js";
import { withDefaults } from "../utils/helpers.js";
import { formatTree } from "../utils/markdown.js";

export function registerGitDataTools(server: McpServer, ctx: ToolContext): void {
  const { client, config, cache } = ctx;

  server.tool(
    "get_tree",
    "Get the file tree of a repository at a given ref (recursive)",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      tree_sha: z.string().describe("Tree SHA or branch name (e.g. 'main')"),
      recursive: z.boolean().optional().default(true),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const qs = params.recursive ? "?recursive=1" : "";
      const resp = await client.get<{ sha: string; tree: Array<Record<string, unknown>>; truncated: boolean }>(
        `/repos/${owner}/${repo}/git/trees/${params.tree_sha}${qs}`
      );
      const text = formatTree(resp.data.tree);
      const truncNote = resp.data.truncated ? "\n\n**Note:** Tree was truncated due to size." : "";
      return { content: [{ type: "text" as const, text: text + truncNote }] };
    }
  );

  server.tool(
    "get_ref",
    "Get a git reference (branch/tag SHA)",
    {
      owner: z.string().optional(),
      repo: z.string().optional(),
      ref: z.string().describe("Reference (e.g. 'heads/main', 'tags/v1.0')"),
    },
    async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}/git/ref/${params.ref}`);
      const obj = resp.data.object as Record<string, unknown>;
      return { content: [{ type: "text" as const, text: `**Ref:** \`${resp.data.ref}\`\n**SHA:** \`${obj.sha}\`\n**Type:** ${obj.type}` }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "create_tree",
      "Create a tree object for multi-file commits",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        base_tree: z.string().optional().describe("SHA of base tree to build on"),
        tree: z.array(z.object({
          path: z.string(),
          mode: z.enum(["100644", "100755", "040000", "160000", "120000"]).default("100644"),
          type: z.enum(["blob", "tree", "commit"]).default("blob"),
          content: z.string().optional().describe("File content (for blobs)"),
          sha: z.string().optional().describe("SHA of existing object (alternative to content)"),
        })).describe("Tree entries"),
      },
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const body: Record<string, unknown> = { tree: params.tree };
        if (params.base_tree) body.base_tree = params.base_tree;
        const resp = await client.post<Record<string, unknown>>(`/repos/${owner}/${repo}/git/trees`, body);
        return { content: [{ type: "text" as const, text: `Tree created: \`${resp.data.sha}\`` }] };
      }
    );

    server.tool(
      "create_commit_object",
      "Create a commit via the Git Data API (for atomic multi-file commits)",
      {
        owner: z.string().optional(),
        repo: z.string().optional(),
        message: z.string().describe("Commit message"),
        tree: z.string().describe("SHA of tree object"),
        parents: z.array(z.string()).describe("Parent commit SHAs"),
        author: z.object({
          name: z.string(),
          email: z.string(),
          date: z.string().optional(),
        }).optional(),
      },
      async (params) => {
        const { owner, repo } = withDefaults(params, config);
        const resp = await client.post<Record<string, unknown>>(`/repos/${owner}/${repo}/git/commits`, {
          message: params.message,
          tree: params.tree,
          parents: params.parents,
          author: params.author,
        });
        cache.invalidatePrefix(`repos:${owner}/${repo}`);
        cache.invalidatePrefix(`branches:${owner}/${repo}`);
        return { content: [{ type: "text" as const, text: `Commit created: \`${resp.data.sha}\`\nMessage: ${params.message}` }] };
      }
    );
  }
}
