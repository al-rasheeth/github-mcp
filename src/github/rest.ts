import { ProxyAgent, Agent, type Dispatcher } from "undici";
import type { Config } from "../config.js";
import type { RestResponse, RequestOptions, RateLimitInfo } from "./types.js";
import { RateLimiter } from "./rate-limiter.js";

export class RestClient {
  private baseUrl: string;
  private token: string;
  private timeout: number;
  private maxRetries: number;
  private rateLimiter: RateLimiter;
  private dispatcher: Dispatcher | undefined;

  constructor(config: Config, rateLimiter: RateLimiter) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, "");
    this.token = config.githubToken;
    this.timeout = config.requestTimeout;
    this.maxRetries = config.maxRetries;
    this.rateLimiter = rateLimiter;
    this.dispatcher = this.createDispatcher(config);
  }

  private createDispatcher(config: Config): Dispatcher | undefined {
    const tlsOptions = config.insecure
      ? { rejectUnauthorized: false }
      : undefined;

    if (config.proxyUrl) {
      return new ProxyAgent({
        uri: config.proxyUrl,
        ...(tlsOptions && { requestTls: tlsOptions }),
      });
    }

    if (tlsOptions) {
      return new Agent({ connect: tlsOptions });
    }

    return undefined;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<RestResponse<T>> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    };

    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.rateLimiter.acquire();

      try {
        const fetchOptions: Record<string, unknown> = {
          method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(options.timeout ?? this.timeout),
        };

        if (this.dispatcher) {
          fetchOptions.dispatcher = this.dispatcher;
        }

        const response = await fetch(url, fetchOptions as RequestInit);

        this.updateRateLimitFromHeaders(response.headers);

        if (response.status === 304) {
          return { data: undefined as T, status: 304, headers: response.headers, etag: response.headers.get("etag") ?? undefined };
        }

        if (response.status === 204) {
          return { data: undefined as T, status: 204, headers: response.headers };
        }

        if (response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          let data: T;
          if (contentType.includes("application/json")) {
            data = (await response.json()) as T;
          } else {
            data = (await response.text()) as T;
          }
          return { data, status: response.status, headers: response.headers, etag: response.headers.get("etag") ?? undefined };
        }

        if (response.status === 429 || response.status >= 500) {
          const retryAfter = this.getRetryDelay(response, attempt);
          if (attempt < this.maxRetries) {
            await this.sleep(retryAfter);
            continue;
          }
        }

        const errorBody = await response.text().catch(() => "");
        throw new Error(`GitHub API error ${response.status}: ${response.statusText}\n${errorBody}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries && this.isRetryable(lastError)) {
          await this.sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  async requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    };

    await this.rateLimiter.acquire();

    const fetchOptions: Record<string, unknown> = {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeout ?? this.timeout),
    };

    if (this.dispatcher) {
      fetchOptions.dispatcher = this.dispatcher;
    }

    return fetch(url, fetchOptions as RequestInit);
  }

  async paginate<T>(path: string, options: RequestOptions = {}, maxPages = 10): Promise<T[]> {
    const results: T[] = [];
    let url: string | null = path.startsWith("http") ? path : `${this.baseUrl}${path}`;

    for (let page = 0; page < maxPages && url; page++) {
      const response = await this.request<T[]>(url, options);
      if (Array.isArray(response.data)) {
        results.push(...response.data);
      }
      url = this.getNextPageUrl(response.headers);
    }

    return results;
  }

  private getNextPageUrl(headers: Headers): string | null {
    const link = headers.get("link");
    if (!link) return null;

    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
  }

  private updateRateLimitFromHeaders(headers: Headers): void {
    const remaining = headers.get("x-ratelimit-remaining");
    const reset = headers.get("x-ratelimit-reset");
    if (remaining != null && reset != null) {
      this.rateLimiter.updateFromHeaders(parseInt(remaining, 10), parseInt(reset, 10));
    }
  }

  private getRetryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }

    const resetHeader = response.headers.get("x-ratelimit-reset");
    if (resetHeader) {
      const resetTime = parseInt(resetHeader, 10) * 1000;
      const waitMs = resetTime - Date.now();
      if (waitMs > 0 && waitMs < 120000) return waitMs;
    }

    return Math.pow(2, attempt) * 1000;
  }

  private isRetryable(error: Error): boolean {
    return (
      error.name === "TimeoutError" ||
      error.message.includes("ECONNRESET") ||
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("fetch failed")
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getRateLimitInfo(headers: Headers): RateLimitInfo {
    return {
      limit: parseInt(headers.get("x-ratelimit-limit") ?? "0", 10),
      remaining: parseInt(headers.get("x-ratelimit-remaining") ?? "0", 10),
      reset: parseInt(headers.get("x-ratelimit-reset") ?? "0", 10),
      used: parseInt(headers.get("x-ratelimit-used") ?? "0", 10),
    };
  }
}
