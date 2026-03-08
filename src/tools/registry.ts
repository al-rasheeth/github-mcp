import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { GitHubClient } from "../github/client.js";
import type { Config } from "../config.js";
import type { Cache } from "../cache.js";

export interface ToolContext {
  client: GitHubClient;
  config: Config;
  cache: Cache;
}

export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;

type FeatureGate = "read" | "write" | "actions" | "dangerous";

export function isGateEnabled(gate: FeatureGate, config: Config): boolean {
  switch (gate) {
    case "read":
      return true;
    case "write":
      return config.writeEnabled;
    case "actions":
      return config.actionsEnabled;
    case "dangerous":
      return config.dangerousEnabled;
  }
}

export const READ_ANNOTATION: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};

export const WRITE_ANNOTATION: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};

export const MODIFY_ANNOTATION: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

export const DESTRUCTIVE_ANNOTATION: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
};

export function registerAllTools(server: McpServer, ctx: ToolContext, registrars: ToolRegistrar[]): void {
  for (const registrar of registrars) {
    registrar(server, ctx);
  }
}
