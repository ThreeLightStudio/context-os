# Context OS

Open-source clients and a personal context server for capturing work and
resuming it across environments.

## Repository layout

```text
apps/
├── client-chrome/   # Local-first Chrome extension
├── client-raycast/  # Raycast extension
├── server-context/  # Cloudflare Worker + D1 Context/Data API
├── server-brain/    # Local-first AI orchestration and execution API
├── server-mcp/      # Local stdio MCP adapter for Context OS
└── server-gateway/  # Provider-neutral external entry-point contract
```

`client-mobile/` is reserved for a future mobile client. Shared packages will
be added only when a stable cross-client contract needs to be extracted.

## 개발

This repository uses pnpm workspaces and Turborepo.

```sh
pnpm install
pnpm verify
```

Run one package with a root filter:

```sh
pnpm dev:chrome
pnpm dev:raycast
pnpm dev:server
pnpm dev:brain
pnpm dev:mcp
```

Build the client bundles:

```sh
pnpm --filter context-shelf build
pnpm --filter context-os build
```

## 설치 모드 선택

데이터를 보관할 위치에 따라 하나를 선택하세요.

| Setup | Best for | Data location | Main components |
| --- | --- | --- | --- |
| [완전 로컬](docs/setup-modes.md#1-완전-로컬-chrome--raycast--workerd1) | 한 대의 컴퓨터와 오프라인 사용 | Chrome 로컬 저장소 또는 로컬 Worker + D1 | Chrome, 선택적으로 Raycast |
| [Cloudflare D1 동기화](docs/setup-modes.md#2-cloudflare-d1-동기화) | Raycast, 여러 클라이언트, 여러 기기 | 내 Cloudflare Worker + D1 | clients + `server-context` |

Chrome은 서버 없이 로컬로 시작한 뒤 나중에 연결할 수 있습니다. Raycast는
Chrome 로컬 저장소를 읽지 않으므로 로컬 Worker/D1 또는 Cloudflare Worker가
필요합니다. 자세한 설치, 배포, 보안 확인 절차는 [설치 모드 가이드](docs/setup-modes.md)를
따르세요.

## Context Server와 D1

The server is deployed independently from `apps/server-context`. Copy the
public configuration template before local development:

```sh
cd apps/server-context
cp wrangler.jsonc.example wrangler.jsonc
pnpm db:migrate:local
pnpm dev
```

The production resource names are `server-context` for the Worker and
`db-context` for the D1 database. The package name is also `server-context`,
so root commands use `pnpm --filter server-context ...`.

원격 명령을 실행하기 전 자신의 D1 database ID, 고유 rate-limit namespace ID,
브라우저 origin을 입력하세요. 실제 `wrangler.jsonc`, `.dev.vars`, API token,
기록 데이터는 절대 커밋하지 않습니다.

Remote migrations and deployment are explicit side-effectful operations:

```sh
pnpm --filter server-context db:migrate:remote
pnpm --filter server-context run deploy
```

Clients connect to the deployed Worker URL and a device token. Moving the
source into this monorepo does not change the API or D1 data.

## 선택 기능: Server Brain

`apps/server-brain` is an independent local Node server for AI orchestration.
Clients call stable Actions such as `summarize` without knowing the model or
prompt. The server uses an OpenAI-compatible local inference endpoint by
default and validates structured results before returning them.

```sh
pnpm --filter server-brain build
pnpm --filter server-brain start
```

`server-context` remains the Context/Data Layer: it owns D1, records, and the
`/v1/records` API. `server-brain` is the Intelligence/Execution Layer: it
owns Actions, Context resolution hooks, model providers, and task lifecycle.
이는 선택 기능입니다. 모델 제공자 설정과 API 예시는
[`apps/server-brain/README.md`](apps/server-brain/README.md)를 참조하세요.

## Context OS MCP Server

`apps/server-mcp` exposes read and append-only Context OS tools through stdio or
Streamable HTTP MCP transport. It calls `server-context` over its existing HTTP
API and never accesses D1 directly.

```sh
cp apps/server-mcp/.env.example apps/server-mcp/.env
pnpm --filter server-mcp build
pnpm --filter server-mcp start
```

For the Streamable HTTP connection form, use `pnpm start:mcp:http`. It listens
at `http://127.0.0.1:8789/mcp` and requires the separate
`CONTEXT_MCP_HTTP_TOKEN` bearer token. The default mode is read-only. Set
`CONTEXT_MCP_MODE=read-write` only when the MCP client should be allowed to
append records. See
[`apps/server-mcp/README.md`](apps/server-mcp/README.md) for Codex and Claude
Desktop and ChatGPT connection examples.

## Migrating existing installations

The server being shared does not make old and new client installations the
same client. Check the client identity before switching from a pre-monorepo
build.

### Chrome extension

The extension manifest does not currently pin a public key, so a new unpacked
build may receive a different extension ID. Chrome storage, shortcuts, and
extension origins are tied to that ID.

When testing a new build:

1. Load the new `apps/client-chrome/dist` from `chrome://extensions` and note
   its ID.
2. Add the new ID to the private `ALLOWED_ORIGINS` value in
   `apps/server-context/wrangler.jsonc`. Multiple origins may be separated by
   commas while both versions are being tested.
3. Deploy the server configuration before testing remote sync.
4. Configure the server URL and API token in the new extension.
5. Disable the old extension after verification.

Do not run both versions as daily drivers. Both can register the same shortcut,
and each capture creates a new record ID. The server only deduplicates an exact
retry of the same record ID; it does not merge captures from two installations.

### Raycast extension

The Raycast extension keeps the package identity `context-os`. Import the
generated `apps/client-raycast/dist` using Raycast's **Import Extension** action
and verify that the existing extension is updated rather than installed as a
second command set. Confirm the Context Settings command and run one capture
before removing or disabling any older installation.

## 외부 진입점과 운영 방식

Context OS는 서비스를 하나로 합치지 않고, 선택적인 단일 public origin 뒤에서 경로로 분리해 운영할 수 있습니다.

- `/v1/*` → `server-context`
- `/mcp` → `server-mcp`
- `/brain/v1/*` → 초기에는 local-only 예약 경로

지원하는 운영 방식은 전부 로컬, Hybrid, Public gateway입니다. 전부 로컬에서는 `server-context`를 Wrangler/local D1, `server-mcp`를 stdio 또는 로컬 HTTP, `server-brain`을 로컬 Node와 local LLM으로 실행합니다. Hybrid에서는 로컬 MCP/Brain이 배포된 Context Worker를 호출하고, Public gateway에서는 하나의 origin이 `/v1/*`와 `/mcp`를 각 서비스로 전달합니다. 초기에는 `/brain/v1/*`을 외부에 공개하지 않습니다.

로컬 포트는 개발용이며 public API 계약이 아닙니다. 기존 `server-context` Worker, D1, migration, token 운영과 직접 Worker URL을 사용하는 기존 클라이언트는 변경 없이 유지됩니다. 자세한 경계와 구성 예시는 [`docs/external-entrypoint.md`](docs/external-entrypoint.md)를 참고하세요.

## License

MIT
