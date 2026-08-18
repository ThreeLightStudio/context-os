# Context OS external entry point

Context OS keeps its services separate while presenting one optional public
origin to external clients. A gateway or reverse proxy owns path selection;
the services do not merge and `server-context` does not execute MCP or Brain
work.

## As-Is → To-Be

The comparison below describes the change introduced by issue #15. Local ports are shown only to explain the current development setup; they are not promoted to public API identifiers.

| Area | As-Is | To-Be |
| --- | --- | --- |
| External access | Clients connect directly to the deployed `server-context` Worker or to local service ports. | An optional single public origin routes `/v1/*` to `server-context` and `/mcp` to `server-mcp`. |
| `server-context` boundary | Cloudflare Worker + D1 owns the Context API and record data. | The same Worker + D1 boundary remains; `GET /v1/records/:id` and revision metadata are additive. |
| MCP boundary | `server-mcp` runs locally over stdio or local HTTP and calls the Context API. | The same adapter can be reached through `/mcp`; it still never accesses D1 directly. |
| Brain boundary | `server-brain` runs as a local Node service with a local LLM. | It remains local-first; `/brain/v1/*` is reserved and not publicly exposed initially. |
| Writes | Context records are append-only captures. | `update_context` appends a new revision with lineage metadata; existing records remain unchanged. |
| Deployment choice | No shared external entry-point contract exists. | A provider-neutral route contract exists; reverse proxy, Cloudflare gateway, Tunnel, and hosting choices remain follow-up decisions. |

The To-Be model changes how clients may enter the system, not which service owns computation or data. `server-context` does not execute MCP or Brain work, and existing direct Worker clients remain compatible.

## Public path contract

```text
https://context.example.com
├── /v1/*        → server-context
├── /mcp         → server-mcp (Streamable HTTP)
└── /brain/v1/*  → reserved; local-only in the initial phase
```

The gateway contract contains paths and service names, not internal hosts or
ports. A provider-specific gateway may centralize request IDs, logging,
tracing, rate limiting, CORS, and edge authentication, while service-specific
authentication and business rules remain in each service.

`server-context` remains the canonical Context data boundary. It owns record
validation, token scopes, CRUD, rate limits, and D1 access. `server-mcp` calls
the Context API and never accesses D1 directly. `server-brain` remains a
local-first Node service backed by a local LLM and is not made public by the
presence of a gateway.

## Supported operating modes

### All local

```text
server-context  http://127.0.0.1:17001  Wrangler + local D1
server-mcp      stdio or http://127.0.0.1:17003/mcp
server-brain    http://127.0.0.1:17002  + local OpenAI-compatible model
```

Use this mode for development and offline work. The local ports are
development details, not part of the public API contract.

### Hybrid

Run `server-mcp` and/or `server-brain` locally while pointing them at a
deployed Context Worker:

```dotenv
CONTEXT_SERVER_URL=https://context.example.com
CONTEXT_SERVER_TOKEN=ctx_<token>
```

The local services still own their own process and ports. Only their Context
API dependency is remote.

### Public gateway

The gateway forwards `/v1/*` to the deployed `server-context` Worker and
`/mcp` to a reachable `server-mcp` Streamable HTTP service. A local
`server-mcp` or `server-brain` cannot be reached from the public gateway
without a Tunnel or another explicitly configured public upstream.

The initial deployment does not expose `/brain/v1/*`; the path is reserved for
a future secure remote-Brain decision.

## Compatibility and deployment

Existing clients may continue to use the deployed `server-context` URL
directly. The external-entrypoint work is additive: it does not change D1
migrations, token management, the Worker deployment name, or the existing
`/v1/records` contract. The Context API also supports reading one record at
`GET /v1/records/:id` and append-only revision metadata for MCP updates.

Choosing Cloudflare Workers, a Tunnel, or another gateway provider is a
separate deployment decision and is intentionally outside this contract.
