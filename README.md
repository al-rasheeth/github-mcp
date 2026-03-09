# GitHub MCP Server

STDIO-based GitHub MCP server using the GitHub REST and GraphQL APIs.

## Setup

1. Install dependencies: `npm install`
2. Set `GITHUB_TOKEN` in your environment or `.env`
3. Build: `npm run build`
4. Run: `npm start` (or `npm run dev` for development)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | **Required.** GitHub personal access token |
| `GITHUB_API_URL` | API base URL (default: `https://api.github.com`) |
| `GITHUB_PROXY_URL` | Proxy URL for outbound HTTPS (e.g. `http://proxy.example:8080`) |
| `PROXY_URL` | Alternative proxy URL (fallback if `GITHUB_PROXY_URL` is unset) |
| `HTTPS_PROXY` | Alternative proxy URL (fallback) |
| `GITHUB_INSECURE` | Set to `"true"` to skip TLS certificate verification |
| `MCP_INSECURE` | Alternative insecure flag (fallback if `GITHUB_INSECURE` is unset) |

### Proxy and TLS

When running behind a corporate proxy or with self-signed certificates, you may see errors like:

```
unable to get local issuer certificate
```

**Fix:** Set `MCP_INSECURE=true` or `GITHUB_INSECURE=true` in your environment. This:

1. Disables TLS certificate verification for outbound HTTPS calls
2. When using the test client, also sets `NODE_TLS_REJECT_UNAUTHORIZED=0` in the spawned server process so the child can talk to APIs behind corporate proxies or self-signed certs

**Proxy:** When `GITHUB_PROXY_URL`, `PROXY_URL`, or `HTTPS_PROXY` is set, the server routes all outbound HTTPS through `HttpsProxyAgent`. The client’s built-in proxy is disabled so only the agent handles the tunnel.

## Test Client

An optional REPL script drives the MCP server as a subprocess (stdio transport):

```bash
npm run test-client
```

The script loads `.env`, spawns the server with the same environment (proxy, tokens, insecure, etc.), and when `MCP_INSECURE` or `GITHUB_INSECURE` is `"true"`, sets `NODE_TLS_REJECT_UNAUTHORIZED=0` in the spawned process to avoid certificate errors.

### REPL Commands

| Command | Description |
|---------|-------------|
| `list-tools` | List available tools |
| `list-resources` | List available resources |
| `list-prompts` | List available prompts |
| `call <tool> [<json-args>]` | Call a tool with optional JSON arguments |
| `resource [uri]` | Read a resource (default: `github://user`) |
| `prompt <name> [<json-args>]` | Get a prompt with optional arguments |
| `quit` | Exit |

### Quick Test

```bash
# Ensure GITHUB_TOKEN is set (e.g. in .env)
npm run test-client
```

Then:
```
> list-tools
> call list_repos {}
```

This lists the authenticated user’s repositories. For a specific owner:

```
> call list_repos {"owner":"octocat","per_page":5}
```

## License

MIT
