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
