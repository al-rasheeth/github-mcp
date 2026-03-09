#!/usr/bin/env npx tsx
/**
 * Test client for the GitHub MCP server.
 * Loads .env, spawns the server as a subprocess (stdio transport), and provides a REPL.
 *
 * Commands: list-tools, list-resources, list-prompts, call <tool> [<json-args>],
 *           resource [uri], prompt <name> [<json-args>], quit
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as readline from "node:readline";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function getServerCommand(): { command: string; args: string[] } {
  const buildPath = path.join(PROJECT_ROOT, "build", "index.js");
  const srcPath = path.join(PROJECT_ROOT, "src", "index.ts");
  try {
    fs.accessSync(buildPath);
    return { command: "node", args: [buildPath] };
  } catch {
    return { command: "npx", args: ["tsx", srcPath] };
  }
}

function buildSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  const insecure =
    process.env.MCP_INSECURE === "true" || process.env.GITHUB_INSECURE === "true";
  if (insecure) {
    env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return env;
}

async function main() {
  const { command, args } = getServerCommand();
  const spawnEnv = buildSpawnEnv();

  const transport = new StdioClientTransport({
    command,
    args,
    env: spawnEnv,
  });

  const client = new Client(
    { name: "github-mcp-test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => rl.question("> ", handleLine);

  async function handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) {
      prompt();
      return;
    }

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    const rest = parts.slice(1);

    try {
      switch (cmd.toLowerCase()) {
        case "list-tools": {
          const res = await client.listTools();
          console.log(
            res.tools.map((t) => `  ${t.name}: ${t.description ?? ""}`).join("\n")
          );
          break;
        }
        case "list-resources": {
          const res = await client.listResources();
          console.log(
            (res.resources ?? [])
              .map((r) => {
                const uri = typeof r.uri === "string" ? r.uri : (r.uri as URL)?.href ?? "";
                return `  ${uri}: ${r.name ?? ""}`;
              })
              .join("\n")
          );
          break;
        }
        case "list-prompts": {
          const res = await client.listPrompts();
          console.log(
            (res.prompts ?? [])
              .map((p) => `  ${p.name}: ${p.description ?? ""}`)
              .join("\n")
          );
          break;
        }
        case "call": {
          const toolName = rest[0];
          if (!toolName) {
            console.log("Usage: call <tool> [<json-args>]");
            break;
          }
          let toolArgs: Record<string, unknown> = {};
          const jsonStr = rest.slice(1).join(" ").trim();
          if (jsonStr) {
            try {
              toolArgs = JSON.parse(jsonStr) as Record<string, unknown>;
            } catch {
              console.log("Invalid JSON args. Example: call list_repos {}");
              break;
            }
          }
          const res = await client.callTool({ name: toolName, arguments: toolArgs });
          console.log(JSON.stringify(res, null, 2));
          break;
        }
        case "resource": {
          const uri = rest[0] ?? "github://user";
          const res = await client.readResource({ uri });
          console.log(JSON.stringify(res, null, 2));
          break;
        }
        case "prompt": {
          const name = rest[0];
          if (!name) {
            console.log("Usage: prompt <name> [<json-args>]");
            break;
          }
          let promptArgs: Record<string, string> = {};
          const promptJsonStr = rest.slice(1).join(" ").trim();
          if (promptJsonStr) {
            try {
              const parsed = JSON.parse(promptJsonStr) as Record<string, unknown>;
              promptArgs = Object.fromEntries(
                Object.entries(parsed).map(([k, v]) => [k, String(v)])
              );
            } catch {
              console.log("Invalid JSON args.");
              break;
            }
          }
          const res = await client.getPrompt({ name, arguments: promptArgs });
          console.log(JSON.stringify(res, null, 2));
          break;
        }
        case "quit":
        case "exit":
        case "q":
          await transport.close();
          rl.close();
          process.exit(0);
        default:
          console.log(
            "Commands: list-tools, list-resources, list-prompts, call <tool> [<json-args>], resource [uri], prompt <name> [<json-args>], quit"
          );
      }
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }
    prompt();
  }

  console.log("GitHub MCP test client. Commands: list-tools, list-resources, list-prompts, call, resource, prompt, quit");
  prompt();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
