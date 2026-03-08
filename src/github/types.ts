export interface RestResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
  etag?: string;
}

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: GraphQLError[];
}

export interface GraphQLError {
  message: string;
  type?: string;
  path?: string[];
  locations?: Array<{ line: number; column: number }>;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

export interface PaginationParams {
  page?: number;
  per_page?: number;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  cacheKey?: string;
  cacheTtl?: number;
  skipCache?: boolean;
}
