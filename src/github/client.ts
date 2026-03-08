import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import type { Config } from "../config.js";
import type { Cache } from "../cache.js";
import { createCustomFetch } from "./dispatcher.js";

type OctokitInstance = InstanceType<typeof Octokit>;

export class GitHubClient {
  readonly octokit: OctokitInstance;
  readonly config: Config;

  constructor(config: Config, cache?: Cache) {
    const customFetch = createCustomFetch(config);

    this.config = config;
    const ExtendedOctokit = Octokit.plugin(retry, throttling);
    this.octokit = new ExtendedOctokit({
      auth: config.githubToken,
      baseUrl: config.apiUrl,
      request: {
        ...(customFetch && { fetch: customFetch }),
        timeout: config.requestTimeout,
      },
      throttle: {
        onRateLimit: (retryAfter: number, options: Record<string, unknown>, _octokit: unknown, retryCount: number) => {
          process.stderr.write(`Rate limit hit for ${options.url}, retrying after ${retryAfter}s (attempt ${retryCount + 1})\n`);
          return retryCount < config.maxRetries;
        },
        onSecondaryRateLimit: (retryAfter: number, options: Record<string, unknown>, _octokit: unknown, retryCount: number) => {
          process.stderr.write(`Secondary rate limit hit for ${options.url}, retrying after ${retryAfter}s\n`);
          return retryCount < 1;
        },
      },
      retry: {
        doNotRetry: [429],
      },
    });

    if (cache) {
      this.installCacheHook(cache);
    }
  }

  private installCacheHook(cache: Cache): void {
    this.octokit.hook.wrap("request", async (request, options) => {
      const method = options.method;
      const url = options.url;

      if (method !== "GET") {
        const response = await request(options);
        cache.invalidateForWrite(url);
        return response;
      }

      const cached = cache.getEntry(url);
      if (cached?.etag) {
        options.headers = { ...options.headers, "if-none-match": cached.etag };
      }

      try {
        const response = await request(options);
        const etag = (response.headers as Record<string, string>).etag;
        cache.setEntry(url, response, etag);
        return response;
      } catch (error: unknown) {
        if (isNotModified(error) && cached) {
          return cached.response as ReturnType<typeof request> extends Promise<infer R> ? R : never;
        }
        throw error;
      }
    });
  }
}

function isNotModified(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 304
  );
}
