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

