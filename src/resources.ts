import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubClient } from "./github/client.js";
import { formatUser, formatRepoList, formatNotificationList, formatRepo, formatIssueList } from "./utils/markdown.js";

export function registerResources(server: McpServer, client: GitHubClient): void {
  server.resource(
    "user-profile",
    "github://user",
    { description: "Authenticated user profile", mimeType: "text/markdown" },
    async (uri) => {
      const resp = await client.get<Record<string, unknown>>("/user");
      return { contents: [{ uri: uri.href, text: formatUser(resp.data), mimeType: "text/markdown" }] };
    }
  );

  server.resource(
    "user-repos",
    "github://repos",
    { description: "List of authenticated user's repositories", mimeType: "text/markdown" },
    async (uri) => {
      const repos = await client.paginate<Record<string, unknown>>("/user/repos?per_page=100&sort=updated", undefined, 3);
      return { contents: [{ uri: uri.href, text: formatRepoList(repos), mimeType: "text/markdown" }] };
    }
  );

  server.resource(
    "notifications",
    "github://notifications",
    { description: "Current unread notifications", mimeType: "text/markdown" },
    async (uri) => {
      const notifications = await client.paginate<Record<string, unknown>>("/notifications?per_page=50", undefined, 2);
      return { contents: [{ uri: uri.href, text: formatNotificationList(notifications), mimeType: "text/markdown" }] };
    }
  );

  server.resource(
    "repo-detail",
    new ResourceTemplate("github://repo/{owner}/{repo}", { list: undefined }),
    { description: "Repository details", mimeType: "text/markdown" },
    async (uri, variables) => {
      const owner = Array.isArray(variables.owner) ? variables.owner[0] : variables.owner;
      const repo = Array.isArray(variables.repo) ? variables.repo[0] : variables.repo;
      const resp = await client.get<Record<string, unknown>>(`/repos/${owner}/${repo}`);
      return { contents: [{ uri: uri.href, text: formatRepo(resp.data), mimeType: "text/markdown" }] };
    }
  );

  server.resource(
    "repo-issues",
    new ResourceTemplate("github://repo/{owner}/{repo}/issues", { list: undefined }),
    { description: "Open issues for a repository", mimeType: "text/markdown" },
    async (uri, variables) => {
      const owner = Array.isArray(variables.owner) ? variables.owner[0] : variables.owner;
      const repo = Array.isArray(variables.repo) ? variables.repo[0] : variables.repo;
      const issues = await client.paginate<Record<string, unknown>>(`/repos/${owner}/${repo}/issues?state=open&per_page=30`, undefined, 3);
      const filtered = issues.filter((i) => !(i as Record<string, unknown>).pull_request);
      return { contents: [{ uri: uri.href, text: formatIssueList(filtered), mimeType: "text/markdown" }] };
    }
  );
}
