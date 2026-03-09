import { encode } from "@toon-format/toon";

/**
 * Truncate very long strings and limit array depth/size for TOON encoding.
 */
function trim(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 4000 ? value.slice(0, 4000) + "...[truncated]" : value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 200).map((v) => trim(v, depth + 1));
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = trim(v, depth + 1);
  }
  return out;
}

/** Encode data as TOON format (token-efficient for LLMs). */
export function toonFormat(data: unknown): string {
  return encode(trim(data));
}

/** Standard MCP tool result: TOON-encoded content. Use for all tool returns. */
export function content(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text: toonFormat(data) }] };
}

/** Standard MCP resource result: TOON-encoded content with uri. */
export function resourceContent(uri: string, data: unknown): { contents: [{ uri: string; text: string; mimeType: string }] } {
  return { contents: [{ uri, text: toonFormat(data), mimeType: "text/plain" }] };
}
