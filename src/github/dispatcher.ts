import { HttpsProxyAgent } from "https-proxy-agent";
import https from "node:https";
import type { Config } from "../config.js";

const PROXY_CONNECT_ERROR = "Proxy connection ended before receiving CONNECT response";

/**
 * Create a custom fetch that uses HttpsProxyAgent when proxy is set,
 * or an insecure https.Agent when TLS verification should be skipped.
 * Pass to Octokit's request.fetch so outbound HTTPS calls go through the agent.
 */
export function createCustomFetch(config: Config): typeof globalThis.fetch | undefined {
  const agent = createAgent(config);
  if (!agent) return undefined;

  const maxRetries = config.maxRetries;

  const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const nodeFetch = (await import("node-fetch")).default;
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    const opts: RequestInit & { agent?: https.Agent } =
      url instanceof Request
        ? { method: url.method, headers: url.headers, body: url.body }
        : { ...init };

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await nodeFetch(urlStr, {
          ...opts,
          agent: urlStr.startsWith("https") ? agent : undefined,
        } as Parameters<typeof nodeFetch>[1]);
        return res as unknown as Response;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes(PROXY_CONNECT_ERROR) &&
          attempt < maxRetries
        ) {
          const delay = Math.min(1000 * 2 ** attempt, 10000);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };
  return fetchFn as typeof globalThis.fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAgent(config: Config): https.Agent | undefined {
  const rejectUnauthorized = !config.insecure;

  if (config.proxyUrl) {
    const agent = new HttpsProxyAgent(config.proxyUrl, { rejectUnauthorized }) as unknown as https.Agent;
    if (config.insecure) {
      wrapAgentForDestinationTls(agent);
    }
    return agent;
  }

  if (config.insecure) {
    return new https.Agent({ rejectUnauthorized: false });
  }

  return undefined;
}

/**
 * Wrap the agent so that when connect(req, opts) is called, we merge
 * rejectUnauthorized: false into opts for the destination TLS.
 * The constructor's rejectUnauthorized only affects the proxy connection;
 * the destination TLS (after CONNECT 200) is a separate tls.connect().
 */
function wrapAgentForDestinationTls(agent: https.Agent): void {
  const a = agent as unknown as { connect(req: unknown, opts: Record<string, unknown>): Promise<unknown> };
  const origConnect = a.connect.bind(agent);
  a.connect = async (req, opts) => {
    return origConnect(req, { ...opts, rejectUnauthorized: false });
  };
}
