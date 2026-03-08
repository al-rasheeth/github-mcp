import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { GitHubClient } from "./github/client.js";
import { Cache } from "./cache.js";
import { registerAllTools } from "./tools/registry.js";
import type { ToolContext } from "./tools/registry.js";

import { registerRepoTools } from "./tools/repos.js";
import { registerBranchTools } from "./tools/branches.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerPullRequestTools } from "./tools/pulls.js";
import { registerCommitTools } from "./tools/commits.js";
import { registerReleaseTools } from "./tools/releases.js";
import { registerActionTools } from "./tools/actions.js";
import { registerSearchTools } from "./tools/search.js";
import { registerGistTools } from "./tools/gists.js";
import { registerOrgTools } from "./tools/orgs.js";
import { registerUserTools } from "./tools/users.js";
import { registerGitDataTools } from "./tools/git-data.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

async function main() {
  const config = loadConfig();

  const client = new GitHubClient(config);
  const cache = new Cache(config);

  const server = new McpServer({
    name: "github-mcp",
    version: "1.0.0",
  });

  const ctx: ToolContext = { client, config, cache };

  registerAllTools(server, ctx, [
    registerRepoTools,
    registerBranchTools,
    registerIssueTools,
    registerPullRequestTools,
    registerCommitTools,
    registerReleaseTools,
    registerActionTools,
    registerSearchTools,
    registerGistTools,
    registerOrgTools,
    registerUserTools,
    registerGitDataTools,
  ]);

  registerResources(server, client);
  registerPrompts(server, client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const gating: string[] = ["read"];
  if (config.writeEnabled) gating.push("write");
  if (config.actionsEnabled) gating.push("actions");
  if (config.dangerousEnabled) gating.push("dangerous");

  process.stderr.write(`github-mcp server started (gates: ${gating.join(", ")})\n`);
  if (config.defaultOwner) process.stderr.write(`  default owner: ${config.defaultOwner}\n`);
  if (config.defaultRepo) process.stderr.write(`  default repo: ${config.defaultRepo}\n`);
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
