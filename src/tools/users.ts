import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./registry.js";
import { isGateEnabled } from "./registry.js";
import { buildQueryString } from "../utils/helpers.js";
import { formatUser, formatNotificationList } from "../utils/markdown.js";

export function registerUserTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  server.tool(
    "get_authenticated_user",
    "Get the currently authenticated user's profile",
    {},
    async () => {
      const resp = await client.get<Record<string, unknown>>("/user");
      return { content: [{ type: "text" as const, text: formatUser(resp.data) }] };
    }
  );

  server.tool(
    "get_user",
    "Get a user's public profile",
    {
      username: z.string().describe("GitHub username"),
    },
    async (params) => {
      const resp = await client.get<Record<string, unknown>>(`/users/${params.username}`);
      return { content: [{ type: "text" as const, text: formatUser(resp.data) }] };
    }
  );

  server.tool(
    "list_notifications",
    "List notifications for the authenticated user",
    {
      all: z.boolean().optional().default(false).describe("Include read notifications"),
      participating: z.boolean().optional().default(false),
      since: z.string().optional().describe("ISO 8601 timestamp"),
      per_page: z.number().min(1).max(100).optional().default(30),
    },
    async (params) => {
      const qs = buildQueryString({
        all: params.all, participating: params.participating,
        since: params.since, per_page: params.per_page,
      });
      const notifications = await client.paginate<Record<string, unknown>>(`/notifications${qs}`, undefined, 3);
      return { content: [{ type: "text" as const, text: formatNotificationList(notifications) }] };
    }
  );

  if (isGateEnabled("write", config)) {
    server.tool(
      "mark_notifications_read",
      "Mark notifications as read",
      {
        last_read_at: z.string().optional().describe("ISO 8601 timestamp. Marks all before this as read. Defaults to now."),
      },
      async (params) => {
        const body = params.last_read_at ? { last_read_at: params.last_read_at } : {};
        await client.put("/notifications", body);
        return { content: [{ type: "text" as const, text: "All notifications marked as read." }] };
      }
    );
  }
}
