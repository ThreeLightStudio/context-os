# Context OS 설치 모드

Context OS는 두 가지 방식으로 실행할 수 있습니다. 둘 다 기록의 소유권은 사용자에게 있으며, API token과 실제 설정 파일은 저장소에 커밋하지 않습니다.

| 모드 | 적합한 경우 | 기록 위치 | Raycast 사용 |
| --- | --- | --- | --- |
| 로컬 | 한 대의 컴퓨터에서 오프라인으로 사용 | Chrome 로컬 저장소 또는 로컬 Worker/D1 | 로컬 Worker/D1 연결 필요 |
| Cloudflare D1 | Chrome과 Raycast를 함께 사용하거나 여러 기기에서 동기화 | 내 Cloudflare Worker + D1 | 배포한 Worker에 연결 |

## 1. 완전 로컬: Chrome + Raycast + Worker/D1

Chrome만 쓴다면 확장을 빌드한 뒤 첫 실행에서 **로컬로 시작**을 선택하면 됩니다. 이 경우 기록은 Chrome 확장 로컬 저장소에만 보관됩니다.

Raycast와 같은 기록을 사용하려면 이 단계까지 진행해 로컬 Context Server와 로컬 D1을 실행합니다.

### 1) 의존성 설치 및 Chrome 확장 ID 확인

```sh
pnpm install
pnpm --filter context-shelf build
```

Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 `apps/client-chrome/dist`를 압축 해제된 확장 프로그램으로 로드합니다. 표시된 확장 ID를 복사합니다.

### 2) 로컬 Worker/D1 준비

```sh
cd apps/server-context
cp wrangler.jsonc.example wrangler.jsonc
```

`.dev.vars` 파일을 만들고 복사한 ID를 정확히 입력합니다.

```dotenv
ALLOWED_ORIGINS=chrome-extension://<extension-id>
```

이 파일과 `wrangler.jsonc`에는 개인 설정이 들어갈 수 있으므로 Git에 추가하지 않습니다.

```sh
pnpm db:migrate:local
pnpm token:create -- --local --name local --read --write
pnpm dev
```

`token:create`가 한 번만 보여 주는 `ctx_…` token을 비밀번호 관리자에 보관합니다. Worker는 기본적으로 `http://127.0.0.1:8787`에서 실행됩니다. 로컬 D1 데이터는 `apps/server-context/.wrangler` 아래에 보관됩니다.

### 3) 클라이언트 연결

- Chrome 확장 → **연결 설정** → **로컬** → `http://127.0.0.1:8787`와 방금 만든 token을 입력하고 **연결 확인**을 실행합니다.
- Raycast → **Context Settings** → **Edit Extension Preferences** → 같은 URL과 token을 입력합니다.

Raycast 확장은 별도로 빌드·가져와야 합니다.

```sh
pnpm --filter context-os build
```

Raycast의 **Import Extension**으로 `apps/client-raycast/dist`를 가져온 뒤 Capture를 한 번 실행하고, Chrome의 **생각 전체 조회**에서 같은 기록이 보이는지 확인합니다.

## 2. Cloudflare D1 동기화

이 흐름의 명령은 Cloudflare 계정의 상태를 바꿉니다. 데이터베이스 생성, 원격 migration, token 생성, 배포 전에 항상 계정과 대상 이름을 확인하세요.

### 1) Chrome 확장 ID와 Cloudflare 계정 확인

Cloudflare Worker의 CORS 허용 목록에는 정확한 Chrome 확장 origin이 필요합니다. 먼저 로컬 가이드의 1단계처럼 Chrome 확장을 빌드·로드하고 ID를 확인합니다.

그 다음 Context Server 디렉터리에서 인증합니다.

```sh
cd apps/server-context
cp wrangler.jsonc.example wrangler.jsonc
pnpm exec wrangler login
pnpm exec wrangler whoami
```

`whoami` 결과가 배포할 계정인지 확인한 뒤에만 다음 단계로 진행합니다.

### 2) D1과 Worker 설정

`db-context` D1 데이터베이스를 만들고 출력된 `database_id`를 복사합니다.

```sh
pnpm exec wrangler d1 create db-context
```

복사한 `wrangler.jsonc`에서 다음 값을 설정합니다.

- `name`: `server-context`
- `d1_databases[0].database_id`: 방금 생성한 D1 ID
- `vars.ALLOWED_ORIGINS`: `chrome-extension://<extension-id>`
- 세 `ratelimits[*].namespace_id`: 계정에서 겹치지 않는 고유 namespace ID 세 개. POST, GET, DELETE에 각각 다른 값을 사용합니다.

`database_id`와 rate-limit namespace ID가 placeholder가 아닌지, `ALLOWED_ORIGINS`가 실제 확장 ID와 정확히 일치하는지 다시 확인합니다.

### 3) 원격 migration, token, 배포

아래 세 명령은 원격 D1 또는 Worker를 변경합니다.

```sh
pnpm db:migrate:remote
pnpm token:create -- --remote --name primary --read --write
pnpm run deploy
```

배포 전후에는 다음을 확인합니다.

```sh
pnpm exec wrangler d1 info db-context
pnpm exec wrangler d1 migrations list db-context --remote
pnpm token:list -- --remote
```

배포 출력의 Worker URL과 생성 직후 한 번만 출력된 token을 각각 Chrome의 **Cloudflare D1** 연결 설정과 Raycast Preferences에 입력합니다. 두 클라이언트에서 **연결 확인** 또는 Capture를 실행해 `401`/`403` 오류 없이 기록이 조회되는지 확인합니다.

## 선택 기능: 로컬 AI 요약

`server-brain`은 두 설치 모드의 필수 구성 요소가 아닙니다. Daily Summary를 쓰고 로컬 OpenAI 호환 모델 런타임(Ollama 등)을 이미 실행 중인 경우에만 설정합니다.

```sh
cp apps/server-brain/.env.example apps/server-brain/.env
pnpm --filter server-brain build
pnpm --filter server-brain start
```

`.env`의 `CONTEXT_SERVER_URL`과 `CONTEXT_SERVER_TOKEN`에는 위에서 선택한 로컬 또는 Cloudflare Context Server를 넣습니다. Chrome 확장 요청을 허용하려면 `BRAIN_ALLOWED_ORIGINS=chrome-extension://<extension-id>`도 설정합니다.

## 운영 안전 수칙

- 실제 `wrangler.jsonc`, `.dev.vars`, `.env`, `ctx_…` token, `.wrangler` 데이터는 커밋하거나 공유하지 않습니다.
- 로컬 D1을 옮기거나 백업할 때는 `wrangler d1 export db-context --local`을 사용하고, 내보낸 데이터는 별도로 보호합니다.
- Cloudflare에서 기기를 분실하거나 token이 노출되면 `pnpm token:revoke -- --remote --id <token-id>`로 즉시 폐기하고 새 token을 만듭니다.
- 같은 Chrome 확장 ID에서는 패널·탭 전환 후에도 연결 설정이 유지됩니다. `저장된 설정을 열지 못했습니다`가 표시되면 새 모드를 선택하지 말고 **다시 시도**해 기존 Chrome 저장소를 보호하세요.
- 이미 과거 버전에서 삭제된 Cloudflare URL이나 token은 복구할 수 없습니다. URL과 token을 한 번 다시 입력하고 **연결 확인 및 저장**을 실행하세요.
