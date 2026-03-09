import { HttpsProxyAgent } from "https-proxy-agent";
import https from "node:https";
import type { Config } from "../config.js";

/**
 * Create a custom fetch that uses HttpsProxyAgent when proxy is set,
 * or an insecure https.Agent when TLS verification should be skipped.
 * Pass to Octokit's request.fetch so outbound HTTPS calls go through the agent.
 */
export function createCustomFetch(config: Config): typeof globalThis.fetch | undefined {
  const agent = createAgent(config);
  if (!agent) return undefined;

  // node-fetch v2 supports agent for HTTPS requests
  const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const nodeFetch = (await import("node-fetch")).default;
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    const opts: RequestInit & { agent?: https.Agent } =
      url instanceof Request
        ? { method: url.method, headers: url.headers, body: url.body }
        : { ...init };
    const res = await nodeFetch(urlStr, {
      ...opts,
      agent: urlStr.startsWith("https") ? agent : undefined,
    } as Parameters<typeof nodeFetch>[1]);
    return res as unknown as Response;
  };
  return fetchFn as typeof globalThis.fetch;
}

function createAgent(config: Config): https.Agent | undefined {
  const rejectUnauthorized = !config.insecure;

  if (config.proxyUrl) {
    return new HttpsProxyAgent(config.proxyUrl, { rejectUnauthorized }) as unknown as https.Agent;
  }

  if (config.insecure) {
    return new https.Agent({ rejectUnauthorized: false });
  }

  return undefined;
}
