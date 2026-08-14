# Server Brain

`server-brain` is the Context OS intelligence and execution layer. Clients
send an Action name and the minimum input they have; they do not need to know
which model, prompt, or Context lookup is used.

```text
client → server-brain → Action → Context source → Model Provider → validated result
```

## Boundary with server-context

`apps/server-context` is the Context/Data Layer. It owns D1, records, token
authentication, and the `/v1/records` API.

`server-brain` is the Intelligence/Execution Layer. It owns Action metadata,
prompt construction, model provider selection, output validation, and the
in-memory task lifecycle. It does not create a database or duplicate records.

## Run locally

Copy `.env.example` to `.env` and set `BRAIN_MODEL` to the model exposed by a
local OpenAI-compatible runtime. The default URL is the OpenAI-compatible
Ollama endpoint; other local runtimes can be selected with `BRAIN_BASE_URL`.

```sh
pnpm install
pnpm --filter server-brain build
pnpm --filter server-brain start
```

The server listens on `127.0.0.1:8788` by default. `BRAIN_API_TOKEN` is
optional for a local process. When it is set, every API request requires the
matching Bearer token. Browser origins must be listed exactly in
`BRAIN_ALLOWED_ORIGINS`.

## API

List available Actions:

```sh
curl http://127.0.0.1:8788/v1/actions
```

Run `summarize`:

```sh
curl -X POST http://127.0.0.1:8788/v1/actions \
  -H 'content-type: application/json' \
  --data '{"action":"summarize","input":{"content":"Context OS를 설계한다."}}'
```

The response contains a validated `{ summary, keyPoints }` result and the
completed task. The task can also be read with `GET /v1/tasks/:id`.

Run `daily-summary` for a local calendar date:

```sh
curl -X POST http://127.0.0.1:8788/v1/actions \
  -H 'content-type: application/json' \
  --data '{"action":"daily-summary","input":{"date":"2026-08-13","timezone":"Asia/Seoul"}}'
```

`daily-summary` reads records from `server-context` when
`CONTEXT_SERVER_URL` and `CONTEXT_SERVER_TOKEN` are configured. It returns
`{ date, timezone, recordCount, summary, keyPoints }`. The date is interpreted
as a local calendar date and converted to a half-open UTC range, so DST-aware
IANA timezones such as `America/Los_Angeles` are supported. A date with no
records returns a deterministic empty summary without calling the model.

Available endpoints are:

- `GET /health`
- `GET /v1/actions`
- `POST /v1/actions`
- `GET /v1/tasks/:id`

## Configuration

| Variable | Purpose |
| --- | --- |
| `BRAIN_HOST` / `BRAIN_PORT` | HTTP bind address and port |
| `BRAIN_PROVIDER` | Provider registry key; `local` is currently supported |
| `BRAIN_BASE_URL` | OpenAI-compatible local runtime base URL |
| `BRAIN_MODEL` | Model name sent to the runtime |
| `BRAIN_PROVIDER_API_KEY` | Optional runtime API key |
| `BRAIN_API_TOKEN` | Optional token protecting server-brain |
| `BRAIN_ALLOWED_ORIGINS` | Comma-separated exact browser origins |
| `CONTEXT_SERVER_URL` | Existing server-context base URL |
| `CONTEXT_SERVER_TOKEN` | Existing `ctx_` token for Context reads |

The Context client is lazy and only used by Actions that define a
`resolveContext` function. This lets a client-provided Context avoid an
unnecessary server-context request and keeps future scheduled executions on
the same TaskRunner pipeline. `daily-summary` uses this resolver to page
through `/v1/records`, stopping once records are older than the requested
local date. The v1 action includes at most 100 records and 64KB of context in
the model prompt.

## Adding an Action

Add an `ActionDefinition` with metadata, input/output parsers, an optional
`resolveContext`, and an `execute` function. Register it in
`src/actions/index.ts`. Prompts belong to the Action implementation, while
model calls go through `ModelProvider`.

Tasks are currently held in memory and are cleared when the process exits.
This is intentional for the MVP; a future persistence or scheduler adapter
can be added without changing the Action execution contract.

## Verification

```sh
pnpm --filter server-brain verify
```

Tests use mock providers and do not download or start a real model.
