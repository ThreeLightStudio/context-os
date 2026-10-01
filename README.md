# Context OS

Open-source clients and a personal context server for capturing work context and retrieving it when you resume across environments.

[한국어](README.ko.md) · [Setup modes](docs/setup-modes.md) · [Context API](apps/server-context/README.md) · [MCP adapter](apps/server-mcp/README.md) · [MIT](LICENSE)

Save a thought next to a browser page, keep a project's browser session, or capture a short note from Raycast. When you return, retrieve the relevant records or use the optional MCP tools to read a saved decision or next step. Chrome can start without a server; sharing Context records with Raycast requires a Context API that both clients can reach.

**Context OS and [StateCarry](https://github.com/ThreeLightStudio/statecarry) solve different parts of returning to work.** Context OS provides capture clients, record storage, and retrieval interfaces. StateCarry analyzes selected project conversations and current project observations to help review a direction and next decision. This repository does not establish an automatic integration between the two.

## Choose where records live

| Setup | Start here | Data boundary |
| --- | --- | --- |
| Chrome only | Build the extension and choose **Start locally** on first launch. | Browser work contexts stay in the extension's Chrome-local storage. Raycast cannot read that storage directly. |
| Local Chrome + Raycast | Run `server-context` with Wrangler and local D1, then connect both clients with its URL and a device token. | Shared Context records live in local D1; Chrome's project/session state remains separate client storage. |
| Your Cloudflare Worker + D1 | Configure and deploy your own Context Server, then connect clients to its URL with scoped device tokens. | Shared records leave the device for your Cloudflare deployment. This is a self-hosted setup, not a managed synchronization service. |

Follow [setup modes](docs/setup-modes.md) for extension origins, token creation, local database setup, and the explicit remote migration/deployment steps. Sharing Context records through the API does not mean every browser-local project or session setting is synchronized.

## Three boundaries to inspect

| Decision | Practical consequence | Public evidence |
| --- | --- | --- |
| Keep Chrome-local persistence distinct from the Worker/D1 record store. | A server connection is an explicit data-location choice; another client does not gain access to Chrome storage. | [Chrome storage](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/client-chrome/src/storage.ts) · [Client guide](apps/client-chrome/README.md) |
| Validate small text records behind scoped device tokens. | An exact retry of the same record ID is idempotent; different content under that ID conflicts. Capture writes append records, while a separate `delete` scope permits removal. | [API implementation](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-context/src/index.ts) · [Record validation](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-context/src/record.ts) · [API fixtures](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-context/test/index.test.ts) |
| Keep MCP and Brain as optional services over the Context API. | MCP has no direct D1 access; its write mode appends revisions. Brain owns model calls and validates their output without duplicating the record database. | [MCP tools](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-mcp/src/tools.ts) · [MCP fixtures](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-mcp/test/tools.test.ts) · [Brain task runner](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-brain/src/tasks/task-runner.ts) |

The Context API accepts bounded text captures and supported metadata. It does not upload attachments, screenshots, HTML, or DOM content. Tokens are stored as hashes in D1; keep raw tokens, actual configuration, and captured data out of Git. See the [server contract](apps/server-context/README.md) for limits and permissions.

## Start locally

The workspace pins pnpm **11.21.0** and uses Turborepo. From the repository root:

```sh
pnpm install
pnpm --filter context-shelf build
```

Load `apps/client-chrome/dist` as an unpacked extension at `chrome://extensions`, then choose local storage. See the [Chrome guide](apps/client-chrome/README.md).

For shared records with Raycast, continue with the [local Worker/D1 setup](docs/setup-modes.md). Its steps include copying `apps/server-context/wrangler.jsonc.example` to your private `wrangler.jsonc`, setting the exact extension origin in `.dev.vars`, applying **local** migrations, and creating a local read/write token. Build Raycast with `pnpm --filter context-os build`, import `apps/client-raycast/dist` using Raycast's **Import Extension**, and verify a capture in the actual client. See the [Raycast guide](apps/client-raycast/README.md).

Development commands from the root:

```sh
pnpm dev:chrome
pnpm dev:raycast
pnpm dev:server
pnpm dev:brain
pnpm --filter server-mcp dev
```

Run only the components your chosen mode needs. `server-context` requires its private configuration and local database setup first. Brain and MCP require their environment settings and dependencies below.

## Optional services

### MCP: read records or append revisions

MCP calls the existing Context API over HTTP. Configure `CONTEXT_SERVER_URL` and `CONTEXT_SERVER_TOKEN` in the copied environment file:

```sh
cp apps/server-mcp/.env.example apps/server-mcp/.env
pnpm --filter server-mcp build
pnpm --filter server-mcp start
```

The default mode is read-only. Set `CONTEXT_MCP_MODE=read-write` to add `create_context` and `update_context`; an update appends a new revision rather than mutating a record. For Streamable HTTP, set a separate `CONTEXT_MCP_HTTP_TOKEN` and run:

```sh
pnpm --filter server-mcp start:http
```

The local endpoint is `http://127.0.0.1:17003/mcp`. The HTTP bearer token protects MCP; the Context device token independently controls access to records. See the [MCP guide](apps/server-mcp/README.md) for client configuration and transport details.

### Brain: opt-in model analysis

Brain is a separate local Node service. Configure a local OpenAI-compatible model runtime and `BRAIN_MODEL`; actions such as `summarize` return validated structured output. For `daily-summary`, also configure the Context API URL/token and the exact Chrome origin in `BRAIN_ALLOWED_ORIGINS` when using Chrome.

```sh
cp apps/server-brain/.env.example apps/server-brain/.env
pnpm --filter server-brain build
pnpm --filter server-brain start
```

Brain does not replace D1 or persist a second copy of Context records. Its model request goes to the configured runtime; review that endpoint before sending private captures. The current provider registry supports the `local` provider. See the [Brain guide](apps/server-brain/README.md) and [provider configuration](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-brain/src/config.ts).

### External gateway: a route contract

The optional contract maps `/v1/*` to Context Server and `/mcp` to MCP. `/brain/v1/*` is reserved and initially local-only. The provider-neutral [external entry-point contract](docs/external-entrypoint.md) does not establish that a gateway, Tunnel, or hosted upstream is deployed. Existing clients can continue using their Worker URL directly.

## Repository map

| Path | Responsibility |
| --- | --- |
| [`apps/client-chrome`](apps/client-chrome/README.md) | Context Shelf Chrome extension; local project/session/URL memory and capture client |
| [`apps/client-raycast`](apps/client-raycast/README.md) | Raycast capture and retrieval client |
| [`apps/server-context`](apps/server-context/README.md) | Worker + D1 Context/Data API, record validation, and device-token scopes |
| [`apps/server-brain`](apps/server-brain/README.md) | Optional local model orchestration and task lifecycle |
| [`apps/server-mcp`](apps/server-mcp/README.md) | Optional stdio / Streamable HTTP MCP adapter |
| [`apps/server-gateway`](apps/server-gateway) | External entry-point contract |

`client-mobile` is reserved for a future client. Shared packages are deferred until a stable cross-client contract needs extraction.

## Status, checks, and existing installations

This repository publishes source and setup guides; no GitHub Release is available as of October 2, 2026. [CI succeeded](https://github.com/ThreeLightStudio/context-os/actions/runs/32220575284) at source revision [`019e405`](https://github.com/ThreeLightStudio/context-os/commit/019e405264b241241fe2fc2bfb6766f450ff613c). That observation does not prove a particular deployed service, real model result, or device acceptance.

```sh
pnpm verify
```

The root command runs repository tests and package lint, type, test, and build tasks. Brain tests use mock model providers. After changing a Raycast UI, verify the rebuilt extension in Raycast; a build alone is insufficient.

When replacing an older Chrome build, check its extension ID before switching: storage, shortcuts, and allowed origins belong to that ID. Configure the new origin and connection before disabling the old build. Two installations can create separate record IDs for the same capture; the server only deduplicates exact retries of one ID. Raycast keeps the `context-os` package identity; confirm **Import Extension** updates the intended installation, check **Context Settings**, and test a capture before removing an older installation. See [setup modes](docs/setup-modes.md) and the client guides for the full checks.

## License

[MIT](LICENSE).
