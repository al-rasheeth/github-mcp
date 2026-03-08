import type { Dispatcher } from "undici";
import type { Config } from "../config.js";
import type { GraphQLResponse, PageInfo } from "./types.js";
import { RateLimiter } from "./rate-limiter.js";

export class GraphQLClient {
  private url: string;
  private token: string;
  private timeout: number;
  private maxRetries: number;
  private rateLimiter: RateLimiter;
  private dispatcher: Dispatcher | undefined;

  constructor(config: Config, rateLimiter: RateLimiter, dispatcher: Dispatcher | undefined) {
    this.url = config.graphqlUrl;
    this.token = config.githubToken;
    this.timeout = config.requestTimeout;
    this.maxRetries = config.maxRetries;
    this.rateLimiter = rateLimiter;
    this.dispatcher = dispatcher;
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.rateLimiter.acquire();

      try {
        const fetchOptions: Record<string, unknown> = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(this.timeout),
        };

        if (this.dispatcher) {
          fetchOptions.dispatcher = this.dispatcher;
        }

        const response = await fetch(this.url, fetchOptions as RequestInit);

        const remaining = response.headers.get("x-ratelimit-remaining");
        const reset = response.headers.get("x-ratelimit-reset");
        if (remaining != null && reset != null) {
          this.rateLimiter.updateFromHeaders(parseInt(remaining, 10), parseInt(reset, 10));
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt < this.maxRetries) {
            await this.sleep(Math.pow(2, attempt) * 1000);
            continue;
          }
        }

        const result = (await response.json()) as GraphQLResponse<T>;

        if (result.errors?.length) {
          const isRateLimit = result.errors.some((e) => e.type === "RATE_LIMITED");
          if (isRateLimit && attempt < this.maxRetries) {
            await this.sleep(Math.pow(2, attempt) * 1000);
            continue;
          }
          throw new Error(
            `GraphQL errors:\n${result.errors.map((e) => `  - ${e.message}`).join("\n")}`
          );
        }

        if (!result.data) {
          throw new Error("GraphQL response contained no data");
        }

        return result.data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries && this.isRetryable(lastError)) {
          await this.sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error("GraphQL request failed after retries");
  }

  async paginateQuery<TNode, TResult>(
    queryFn: (cursor: string | null) => { query: string; variables: Record<string, unknown> },
    extractConnection: (data: TResult) => { nodes: TNode[]; pageInfo: PageInfo },
    maxPages = 10
  ): Promise<TNode[]> {
    const allNodes: TNode[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const { query, variables } = queryFn(cursor);
      const data = await this.query<TResult>(query, variables);
      const connection = extractConnection(data);

      allNodes.push(...connection.nodes);

      if (!connection.pageInfo.hasNextPage) break;
      cursor = connection.pageInfo.endCursor;
    }

    return allNodes;
  }

  private isRetryable(error: Error): boolean {
    return (
      error.name === "TimeoutError" ||
      error.message.includes("ECONNRESET") ||
      error.message.includes("fetch failed")
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
