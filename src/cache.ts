import { LRUCache } from "lru-cache";
import { ENTITY_TTL } from "./config.js";
import type { Config } from "./config.js";

interface CacheEntry {
  response: unknown;
  etag?: string;
  entityType: string;
}

const ENTITY_PATTERNS: [RegExp, string][] = [
  [/\/repos\/[^/]+\/[^/]+\/pulls\//, "pulls"],
  [/\/repos\/[^/]+\/[^/]+\/issues\//, "issues"],
  [/\/repos\/[^/]+\/[^/]+\/branches\//, "branches"],
  [/\/repos\/[^/]+\/[^/]+\/releases\//, "releases"],
  [/\/repos\/[^/]+\/[^/]+\/actions\//, "workflows"],
  [/\/repos\/[^/]+\/[^/]+/, "repos"],
  [/\/users\//, "users"],
];

function inferEntityType(url: string): string {
  for (const [pattern, type] of ENTITY_PATTERNS) {
    if (pattern.test(url)) return type;
  }
  return "default";
}

function deriveCacheScope(url: string): string {
  const match = url.match(/\/repos\/([^/]+\/[^/]+)/);
  return match ? match[1] : url;
}

export class Cache {
  private store: LRUCache<string, CacheEntry>;
  private defaultTtl: number;

  constructor(config: Config) {
    this.defaultTtl = config.cacheTtl * 1000;
    this.store = new LRUCache<string, CacheEntry>({
      max: config.cacheMax,
      ttl: this.defaultTtl,
    });
  }

  getEntry(url: string): { response: unknown; etag?: string } | undefined {
    const entry = this.store.get(url);
    if (!entry) return undefined;
    return { response: entry.response, etag: entry.etag };
  }

  setEntry(url: string, response: unknown, etag?: string): void {
    const entityType = inferEntityType(url);
    const ttlSeconds = ENTITY_TTL[entityType];
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtl;
    this.store.set(url, { response, etag, entityType }, { ttl });
  }

  invalidateForWrite(url: string): void {
    const scope = deriveCacheScope(url);
    const entityType = inferEntityType(url);
    for (const key of this.store.keys()) {
      const entry = this.store.peek(key);
      if (entry && entry.entityType === entityType && key.includes(scope)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}
