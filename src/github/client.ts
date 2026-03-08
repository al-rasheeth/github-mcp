import type { Config } from "../config.js";
import type { RestResponse, RequestOptions, PageInfo } from "./types.js";
import { RestClient } from "./rest.js";
import { GraphQLClient } from "./graphql.js";
import { RateLimiter } from "./rate-limiter.js";

export class GitHubClient {
  readonly rest: RestClient;
  readonly graphql: GraphQLClient;
  readonly config: Config;

  constructor(config: Config) {
    const rateLimiter = new RateLimiter(config.rateLimit);
    this.rest = new RestClient(config, rateLimiter);
    this.graphql = new GraphQLClient(config, rateLimiter);
    this.config = config;
  }

  async get<T>(path: string, options?: RequestOptions): Promise<RestResponse<T>> {
    return this.rest.request<T>(path, { ...options, method: "GET" });
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<RestResponse<T>> {
    return this.rest.request<T>(path, { ...options, method: "POST", body });
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<RestResponse<T>> {
    return this.rest.request<T>(path, { ...options, method: "PATCH", body });
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<RestResponse<T>> {
    return this.rest.request<T>(path, { ...options, method: "PUT", body });
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<RestResponse<T>> {
    return this.rest.request<T>(path, { ...options, method: "DELETE" });
  }

  async paginate<T>(path: string, options?: RequestOptions, maxPages?: number): Promise<T[]> {
    return this.rest.paginate<T>(path, options, maxPages);
  }

  async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.graphql.query<T>(query, variables);
  }

  async gqlPaginate<TNode, TResult>(
    queryFn: (cursor: string | null) => { query: string; variables: Record<string, unknown> },
    extractConnection: (data: TResult) => { nodes: TNode[]; pageInfo: PageInfo },
    maxPages?: number
  ): Promise<TNode[]> {
    return this.graphql.paginateQuery<TNode, TResult>(queryFn, extractConnection, maxPages);
  }

  async getRaw(path: string, options?: RequestOptions): Promise<Response> {
    return this.rest.requestRaw(path, options);
  }
}
