import { fetch as undiciFetch, ProxyAgent, Agent, type Dispatcher } from "undici";
import type { Config } from "../config.js";

export function createCustomFetch(config: Config): typeof globalThis.fetch | undefined {
  const dispatcher = createDispatcher(config);
  if (!dispatcher) return undefined;

  return ((url: string | URL | Request, init?: RequestInit) =>
    undiciFetch(url as Parameters<typeof undiciFetch>[0], {
      ...init,
      dispatcher,
    } as Parameters<typeof undiciFetch>[1])) as unknown as typeof globalThis.fetch;
}

function createDispatcher(config: Config): Dispatcher | undefined {
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
