import { LRUCache } from "lru-cache";
import { ENTITY_TTL } from "./config.js";
import type { Config } from "./config.js";

interface CacheEntry<T = unknown> {
  data: T;
  etag?: string;
  entityType?: string;
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

  get<T>(key: string): { data: T; etag?: string } | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    return { data: entry.data, etag: entry.etag };
  }

  set<T>(key: string, data: T, entityType?: string, etag?: string): void {
    const ttlSeconds = entityType ? ENTITY_TTL[entityType] : undefined;
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtl;

    this.store.set(
      key,
      { data, etag, entityType },
      { ttl }
    );
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}
