# Local service ports

Context OS reserves the `17XXX` range for local development services. Assign
ports in dependency order so the local stack stays predictable.

| Service | Package | Host | Port | Ownership |
| --- | --- | --- | --- | --- |
| Context Server | `server-context` | `127.0.0.1` | `17001` | Worker/D1 records API; MCP target |
| Brain Server | `server-brain` | `127.0.0.1` | `17002` | Local intelligence and action API |
| MCP Server | `server-mcp` | — | stdio | Does not bind an HTTP port; connects to Context Server |

Ports `17003` and above remain available for future HTTP services. These local
ports do not affect Cloudflare deployment URLs or ephemeral test servers.
