import type { Config } from "../config.js";

export function decodeBase64(content: string): string {
  return Buffer.from(content, "base64").toString("utf-8");
}

export function withDefaults<T extends { owner?: string; repo?: string }>(
  params: T,
  config: Config
): T & { owner: string; repo: string } {
  const owner = params.owner || config.defaultOwner;
  const repo = params.repo || config.defaultRepo;
  if (!owner) throw new Error("owner is required (no default configured via GITHUB_DEFAULT_OWNER)");
  if (!repo) throw new Error("repo is required (no default configured via GITHUB_DEFAULT_REPO)");
  return { ...params, owner, repo };
}

export function withOwnerDefault<T extends { owner?: string }>(
  params: T,
  config: Config
): T & { owner: string } {
  const owner = params.owner || config.defaultOwner;
  if (!owner) throw new Error("owner is required (no default configured via GITHUB_DEFAULT_OWNER)");
  return { ...params, owner };
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "N/A";
  return new Date(date).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
