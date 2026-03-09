import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubClient } from "./github/client.js";
import { resourceContent } from "./utils/toon.js";

export function registerResources(server: McpServer, client: GitHubClient): void {
  server.registerResource("user-profile", "github://user", {
    description: "Authenticated user profile",
    mimeType: "text/plain",
  }, async (uri) => {
    const { data } = await client.octokit.rest.users.getAuthenticated();
    return resourceContent(uri.href, data);
  });

  server.registerResource("user-repos", "github://repos", {
    description: "List of authenticated user's repositories",
    mimeType: "text/plain",
  }, async (uri) => {
    const repos = await client.octokit.paginate(client.octokit.rest.repos.listForAuthenticatedUser, { per_page: 100, sort: "updated" });
    return resourceContent(uri.href, repos);
  });

  server.registerResource("notifications", "github://notifications", {
    description: "Current unread notifications",
    mimeType: "text/plain",
  }, async (uri) => {
    const notifications = await client.octokit.paginate(client.octokit.rest.activity.listNotificationsForAuthenticatedUser, { per_page: 50 });
    return resourceContent(uri.href, notifications);
  });

  server.registerResource("repo-detail", new ResourceTemplate("github://repo/{owner}/{repo}", { list: undefined }), {
    description: "Repository details",
    mimeType: "text/plain",
  }, async (uri, variables) => {
    const owner = Array.isArray(variables.owner) ? variables.owner[0] : variables.owner;
    const repo = Array.isArray(variables.repo) ? variables.repo[0] : variables.repo;
    const { data } = await client.octokit.rest.repos.get({ owner, repo });
    return resourceContent(uri.href, data);
  });

  server.registerResource("repo-issues", new ResourceTemplate("github://repo/{owner}/{repo}/issues", { list: undefined }), {
    description: "Open issues for a repository",
    mimeType: "text/plain",
  }, async (uri, variables) => {
    const owner = Array.isArray(variables.owner) ? variables.owner[0] : variables.owner;
    const repo = Array.isArray(variables.repo) ? variables.repo[0] : variables.repo;
    const issues = await client.octokit.paginate(client.octokit.rest.issues.listForRepo, { owner, repo, state: "open", per_page: 30 });
    const filtered = issues.filter((i) => !i.pull_request);
    return resourceContent(uri.href, filtered);
  });
}
