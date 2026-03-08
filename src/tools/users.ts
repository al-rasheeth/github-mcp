import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled, READ_ANNOTATION, WRITE_ANNOTATION } from "./registry.js";
import { formatUser, formatNotificationList } from "../utils/markdown.js";

export function registerUserTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.registerTool("get_authenticated_user", {
    description: "Get the currently authenticated user's profile",
    inputSchema: {},
    annotations: READ_ANNOTATION,
  }, async () => {
    const { data } = await client.octokit.rest.users.getAuthenticated();
    return { content: [{ type: "text" as const, text: formatUser(data as Record<string, unknown>) }] };
  });

  server.registerTool("get_user", {
    description: "Get a user's public profile",
    inputSchema: {
      username: z.string().describe("GitHub username"),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const { data } = await client.octokit.rest.users.getByUsername({ username: params.username });
    return { content: [{ type: "text" as const, text: formatUser(data as Record<string, unknown>) }] };
  });

  server.registerTool("list_notifications", {
    description: "List notifications for the authenticated user",
    inputSchema: {
      all: z.boolean().optional().default(false).describe("Include read notifications"),
      participating: z.boolean().optional().default(false),
      since: z.string().optional().describe("ISO 8601 timestamp"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    annotations: READ_ANNOTATION,
  }, async (params) => {
    const notifications = await client.octokit.paginate(
      client.octokit.rest.activity.listNotificationsForAuthenticatedUser,
      {
        all: params.all,
        participating: params.participating,
        since: params.since,
        per_page: params.per_page,
      }
    );
    return { content: [{ type: "text" as const, text: formatNotificationList(notifications as Record<string, unknown>[]) }] };
  });

  if (isGateEnabled("write", config)) {
    server.registerTool("mark_notifications_read", {
      description: "Mark notifications as read",
      inputSchema: {
        last_read_at: z.string().optional().describe("ISO 8601 timestamp. Marks all before this as read. Defaults to now."),
      },
      annotations: WRITE_ANNOTATION,
    }, async (params) => {
      await client.octokit.rest.activity.markNotificationsAsRead(
        params.last_read_at ? { last_read_at: params.last_read_at } : {}
      );
      return { content: [{ type: "text" as const, text: "All notifications marked as read." }] };
    });
  }
}
