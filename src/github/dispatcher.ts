import { ProxyAgent, Agent, type Dispatcher } from "undici";
import type { Config } from "../config.js";

export function createDispatcher(config: Config): Dispatcher | undefined {
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
