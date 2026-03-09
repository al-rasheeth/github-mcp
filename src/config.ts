import { z } from "zod";

const booleanString = z
  .string()
  .default("false")
  .transform((v) => v.toLowerCase() === "true");

const positiveInt = (defaultVal: number) =>
  z
    .string()
    .default(String(defaultVal))
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive());

const configSchema = z.object({
  githubToken: z.string().min(1, "GITHUB_TOKEN is required"),
  apiUrl: z.string().url().default("https://api.github.com"),
  proxyUrl: z.string().url().optional(),
  insecure: booleanString,

  writeEnabled: booleanString,
  actionsEnabled: booleanString,
  dangerousEnabled: booleanString,

  cacheTtl: positiveInt(300),
  cacheMax: positiveInt(500),
  requestTimeout: positiveInt(30000),
  maxRetries: positiveInt(3),

  defaultOwner: z.string().optional(),
  defaultRepo: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const raw = {
    githubToken: process.env.GITHUB_TOKEN ?? "",
    apiUrl: process.env.GITHUB_API_URL,
    proxyUrl:
      process.env.GITHUB_PROXY_URL ||
      process.env.PROXY_URL ||
      process.env.HTTPS_PROXY ||
      undefined,
    insecure: process.env.GITHUB_INSECURE ?? process.env.MCP_INSECURE,
    writeEnabled: process.env.GITHUB_WRITE_ENABLED,
    actionsEnabled: process.env.GITHUB_ACTIONS_ENABLED,
    dangerousEnabled: process.env.GITHUB_DANGEROUS_ENABLED,
    cacheTtl: process.env.GITHUB_CACHE_TTL,
    cacheMax: process.env.GITHUB_CACHE_MAX,
    requestTimeout: process.env.GITHUB_REQUEST_TIMEOUT,
    maxRetries: process.env.GITHUB_MAX_RETRIES,
    defaultOwner: process.env.GITHUB_DEFAULT_OWNER || undefined,
    defaultRepo: process.env.GITHUB_DEFAULT_REPO || undefined,
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }
  return result.data;
}

export const ENTITY_TTL: Record<string, number> = {
  repos: 600,
  issues: 60,
  pulls: 60,
  users: 300,
  branches: 120,
  workflows: 300,
  releases: 600,
};
