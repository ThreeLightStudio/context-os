# Context OS MCP Server

`server-mcp` exposes Context OS through stdio and Streamable HTTP MCP
transports. It connects to the existing `server-context` `/v1/records` API and
does not access D1 directly.

## Local setup

Keep the existing `server-context` API running on its configured port (the
example uses `17001`). To expose the MCP endpoint for a client that provides a
URI, start `server-mcp` on the reserved port `17003`:

```sh
cp apps/server-mcp/.env.example apps/server-mcp/.env
# Set CONTEXT_MCP_TRANSPORT=streamable-http
# Set CONTEXT_MCP_HTTP_TOKEN to a separate bearer token.
pnpm --filter server-mcp start:http
```

The Streamable HTTP endpoint is:

```text
http://127.0.0.1:17003/mcp
```

The bearer token in `CONTEXT_MCP_HTTP_TOKEN` protects the MCP endpoint. The
separate `CONTEXT_SERVER_TOKEN` is used by the MCP server when calling
`server-context` and should have only the Context API scopes it needs.

For stdio clients, keep `CONTEXT_MCP_TRANSPORT=stdio`:

```sh
cp apps/server-mcp/.env.example apps/server-mcp/.env
pnpm --filter server-mcp build
pnpm --filter server-mcp start
```

The default `CONTEXT_MCP_MODE=read` registers the canonical read tools:
`search_context`, `get_context`, `get_recent_contexts`, and
`get_active_context`. Set `CONTEXT_MCP_MODE=read-write` to add
`create_context` and `update_context`. The previous names remain available as
deprecated compatibility aliases. `update_context` appends a new revision and
never modifies an existing Context record.

The Streamable HTTP path is `/mcp` both locally and behind the external-entry
point contract. `server-mcp` continues to call `server-context` over its HTTP
API and has no D1 dependency.

For all-local, hybrid, and public-gateway operating modes, see
[`docs/external-entrypoint.md`](../../docs/external-entrypoint.md).

## Verification

Run the package tests and verification from the repository root:

```sh
pnpm --filter server-mcp verify
pnpm verify
```

The stdio integration test starts a mock Context API, connects with an MCP
client, checks the tool list, performs read/write calls, and verifies that
stdout contains only MCP JSON-RPC traffic.

## Client configuration

Codex uses a trusted `~/.codex/config.toml` or project `.codex/config.toml`:

```toml
[mcp_servers.context_os]
command = "node"
args = ["/absolute/path/to/apps/server-mcp/dist/index.js"]
env_vars = ["CONTEXT_SERVER_URL", "CONTEXT_SERVER_TOKEN", "CONTEXT_MCP_MODE"]
default_tools_approval_mode = "writes"
```

Claude Desktop uses the same `command` and `args` in its `mcpServers`
configuration and passes the values through `env`.

For the Streamable HTTP connection form shown in ChatGPT, choose
`Streamable HTTP`, use `http://127.0.0.1:17003/mcp` as the URI, and configure the
bearer token environment variable to the value used for
`CONTEXT_MCP_HTTP_TOKEN`.
