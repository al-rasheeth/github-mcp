import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { withDefaults } from "../utils/helpers.js";
import { toonFormat } from "../utils/toon.js";

export function registerGitDataTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("get_tree", {
    description: "Get the file tree of a repository at a given ref (recursive)",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      tree_sha: z.string().describe("Tree SHA or branch name (e.g. 'main')"),
      recursive: z.boolean().optional().default(true),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: params.tree_sha,
      ...(params.recursive ? { recursive: "1" as const } : {}),
    });
    const out = { tree: data.tree, truncated: data.truncated };
    return { content: [{ type: "text" as const, text: toonFormat(out) }] };
  });

  server.registerTool("get_ref", {
    description: "Get a git reference (branch/tag SHA)",
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      ref: z.string().describe("Reference (e.g. 'heads/main', 'tags/v1.0')"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { owner, repo } = withDefaults(params, config);
    const { data } = await client.octokit.rest.git.getRef({
      owner,
      repo,
      ref: params.ref,
    });
    return { content: [{ type: "text" as const, text: toonFormat(data) }] };
  });

  if (isGateEnabled("write", config)) {
    server.registerTool("create_tree", {
      description: "Create a tree object for multi-file commits",
      inputSchema: {
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
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const body: { tree: typeof params.tree; base_tree?: string } = { tree: params.tree };
      if (params.base_tree) body.base_tree = params.base_tree;
      const { data } = await client.octokit.rest.git.createTree({
        owner,
        repo,
        ...body,
      });
      return { content: [{ type: "text" as const, text: toonFormat(data) }] };
    });

    server.registerTool("create_commit_object", {
      description: "Create a commit via the Git Data API (for atomic multi-file commits)",
      inputSchema: {
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
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      const { owner, repo } = withDefaults(params, config);
      const { data } = await client.octokit.rest.git.createCommit({
        owner,
        repo,
        message: params.message,
        tree: params.tree,
        parents: params.parents,
        author: params.author,
      });
      return { content: [{ type: "text" as const, text: toonFormat({ sha: data.sha, message: params.message }) }] };
    });
  }
}
