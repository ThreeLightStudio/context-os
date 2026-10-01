# Context OS

작업 맥락을 기록하고 다른 환경에서 다시 꺼내 볼 수 있도록 하는 오픈소스 클라이언트와 개인 맥락 서버입니다.

[English](README.md) · [설치 모드](docs/setup-modes.md) · [Context API](apps/server-context/README.md) · [MCP 어댑터](apps/server-mcp/README.md) · [MIT](LICENSE)

브라우저 페이지에 생각을 남기거나 프로젝트의 브라우저 세션을 보관하고, Raycast에서 짧은 메모를 기록할 수 있습니다. 다시 돌아오면 관련 기록을 조회하거나 선택적인 MCP 도구로 저장한 결정과 다음 할 일을 읽습니다. Chrome은 서버 없이 시작할 수 있습니다. Raycast와 Context 기록을 공유하려면 두 클라이언트가 접근할 수 있는 Context API가 필요합니다.

**Context OS와 [StateCarry](https://github.com/ThreeLightStudio/statecarry)는 작업 복귀의 서로 다른 부분을 다룹니다.** Context OS는 기록 클라이언트, 저장소, 조회 인터페이스를 제공합니다. StateCarry는 선택한 프로젝트 대화와 현재 프로젝트 관찰을 분석해 방향과 다음 판단을 검토하도록 돕습니다. 이 저장소가 둘 사이의 자동 통합을 입증하지는 않습니다.

## 기록을 어디에 보관할지 선택하기

| 구성 | 시작 방법 | 데이터 경계 |
| --- | --- | --- |
| Chrome만 사용 | 확장을 빌드하고 첫 실행에서 **로컬로 시작**을 선택합니다. | 브라우저 작업 맥락은 해당 확장의 Chrome 로컬 저장소에 남습니다. Raycast가 직접 읽을 수 없습니다. |
| 로컬 Chrome + Raycast | Wrangler와 로컬 D1으로 `server-context`를 실행하고 URL·기기 토큰으로 양쪽을 연결합니다. | 공유 Context 기록은 로컬 D1에 저장하고 Chrome 프로젝트·세션 상태는 별도 클라이언트 저장소에 둡니다. |
| 개인 Cloudflare Worker + D1 | 직접 Context Server를 설정·배포하고 URL과 권한별 기기 토큰으로 연결합니다. | 공유 기록이 기기를 떠나 개인 Cloudflare 배포에 저장됩니다. 직접 운영하는 구성으로, 관리형 동기화 서비스가 아닙니다. |

확장 origin, 토큰 생성, 로컬 DB 준비, 명시적인 원격 migration·배포 단계는 [설치 모드 가이드](docs/setup-modes.md)를 따르세요. API로 Context 기록을 공유한다고 해서 브라우저 내부 프로젝트·세션 설정까지 모두 동기화되는 것은 아닙니다.

## 확인할 세 가지 경계

| 결정 | 의미 | 공개 근거 |
| --- | --- | --- |
| Chrome 로컬 저장과 Worker/D1 기록 저장을 구분합니다. | 서버 연결은 명시적인 데이터 위치 선택입니다. 다른 클라이언트가 Chrome 저장소에 접근할 수 있게 되는 것은 아닙니다. | [Chrome 저장 구현](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/client-chrome/src/storage.ts) · [클라이언트 가이드](apps/client-chrome/README.md) |
| 작은 텍스트 기록을 검증하고 기기 토큰의 권한으로 보호합니다. | 같은 ID의 동일 요청 재시도는 중복 저장하지 않고, 다른 내용이면 충돌합니다. 기록 쓰기는 추가 방식이며, 별도 `delete` 권한으로 제거할 수 있습니다. | [API 구현](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-context/src/index.ts) · [기록 검증](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-context/src/record.ts) · [API 테스트 사례](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-context/test/index.test.ts) |
| MCP와 Brain을 Context API 위의 선택적인 서비스로 둡니다. | MCP는 D1에 직접 접근하지 않고 쓰기 모드에서도 새 리비전을 추가합니다. Brain은 기록 DB를 복제하지 않고 모델 호출과 결과 검증을 담당합니다. | [MCP 도구](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-mcp/src/tools.ts) · [MCP 테스트 사례](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-mcp/test/tools.test.ts) · [Brain 실행기](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-brain/src/tasks/task-runner.ts) |

Context API는 크기가 제한된 텍스트와 지원하는 메타데이터를 받습니다. 첨부 파일·스크린샷·HTML·DOM 콘텐츠 업로드는 지원하지 않습니다. D1에는 토큰의 해시를 저장합니다. 원래 토큰, 실제 설정, 기록 데이터는 Git에 넣지 마세요. 제한과 권한은 [서버 계약](apps/server-context/README.md)에 있습니다.

## 로컬에서 시작하기

워크스페이스는 pnpm **11.21.0**과 Turborepo를 사용합니다. 저장소 루트에서 실행하세요.

```sh
pnpm install
pnpm --filter context-shelf build
```

`chrome://extensions`에서 `apps/client-chrome/dist`를 압축 해제된 확장으로 로드하고 로컬 저장을 선택합니다. [Chrome 가이드](apps/client-chrome/README.md)를 참고하세요.

Raycast와 기록을 공유하려면 [로컬 Worker/D1 설치](docs/setup-modes.md)를 이어서 진행합니다. `apps/server-context/wrangler.jsonc.example`을 개인 `wrangler.jsonc`로 복사하고, `.dev.vars`에 정확한 확장 origin을 지정하며, **로컬** migration과 읽기·쓰기 토큰 생성을 수행합니다. Raycast는 `pnpm --filter context-os build`로 빌드한 뒤 **Import Extension**으로 `apps/client-raycast/dist`를 가져옵니다. 실제 클라이언트에서 기록을 한 번 확인하세요. [Raycast 가이드](apps/client-raycast/README.md)를 참고하세요.

루트에서 사용하는 개발 명령입니다.

```sh
pnpm dev:chrome
pnpm dev:raycast
pnpm dev:server
pnpm dev:brain
pnpm --filter server-mcp dev
```

선택한 구성에 필요한 서비스만 실행합니다. Context Server는 개인 설정과 로컬 DB 준비가 먼저 필요합니다. Brain과 MCP도 아래 환경 설정과 의존 서비스를 준비해야 합니다.

## 선택 기능

### MCP: 기록 읽기와 리비전 추가

MCP는 기존 Context API를 HTTP로 호출합니다. 복사한 환경 파일에 `CONTEXT_SERVER_URL`과 `CONTEXT_SERVER_TOKEN`을 설정하세요.

```sh
cp apps/server-mcp/.env.example apps/server-mcp/.env
pnpm --filter server-mcp build
pnpm --filter server-mcp start
```

기본은 읽기 전용입니다. `CONTEXT_MCP_MODE=read-write`로 `create_context`와 `update_context`를 추가할 수 있습니다. 업데이트는 기존 기록을 수정하지 않고 새 리비전을 추가합니다. Streamable HTTP를 사용하려면 별도 `CONTEXT_MCP_HTTP_TOKEN`을 설정하고 다음 명령을 실행합니다.

```sh
pnpm --filter server-mcp start:http
```

로컬 엔드포인트는 `http://127.0.0.1:17003/mcp`입니다. HTTP bearer 토큰은 MCP를 보호하고 Context 기기 토큰은 기록 접근 권한을 따로 제어합니다. 클라이언트 설정과 전송 방식은 [MCP 가이드](apps/server-mcp/README.md)에 있습니다.

### Brain: 선택적인 모델 분석

Brain은 별도의 로컬 Node 서비스입니다. 로컬 OpenAI 호환 모델 런타임과 `BRAIN_MODEL`을 설정하면 `summarize` 같은 Action이 검증된 구조화 결과를 반환합니다. `daily-summary`에는 Context API URL·토큰도 필요하며 Chrome에서 사용하려면 `BRAIN_ALLOWED_ORIGINS`에 정확한 확장 origin을 지정합니다.

```sh
cp apps/server-brain/.env.example apps/server-brain/.env
pnpm --filter server-brain build
pnpm --filter server-brain start
```

Brain은 D1을 대체하거나 Context 기록을 별도 DB에 복제하지 않습니다. 모델 요청은 설정한 런타임으로 보내므로 비공개 기록을 전송하기 전에 주소를 확인하세요. 현재 제공자 레지스트리는 `local` 제공자를 지원합니다. [Brain 가이드](apps/server-brain/README.md)와 [제공자 설정](https://github.com/ThreeLightStudio/context-os/blob/019e405264b241241fe2fc2bfb6766f450ff613c/apps/server-brain/src/config.ts)을 참고하세요.

### 외부 gateway: 경로 계약

선택적인 계약은 `/v1/*`를 Context Server로, `/mcp`를 MCP로 연결합니다. `/brain/v1/*`는 예약 경로이며 초기에는 로컬 전용입니다. 공급자 중립적인 [외부 진입점 계약](docs/external-entrypoint.md)이 있다는 사실만으로 gateway·Tunnel·호스팅된 upstream 배포를 확인할 수는 없습니다. 기존 클라이언트는 Worker URL을 계속 직접 사용할 수 있습니다.

## 저장소 구성

| 경로 | 책임 |
| --- | --- |
| [`apps/client-chrome`](apps/client-chrome/README.md) | Context Shelf Chrome 확장, 로컬 프로젝트·세션·URL 기억과 기록 클라이언트 |
| [`apps/client-raycast`](apps/client-raycast/README.md) | Raycast 기록·조회 클라이언트 |
| [`apps/server-context`](apps/server-context/README.md) | Worker + D1 Context/Data API, 기록 검증과 기기 토큰 권한 |
| [`apps/server-brain`](apps/server-brain/README.md) | 선택적인 로컬 모델 오케스트레이션과 작업 수명주기 |
| [`apps/server-mcp`](apps/server-mcp/README.md) | 선택적인 stdio / Streamable HTTP MCP 어댑터 |
| [`apps/server-gateway`](apps/server-gateway) | 외부 진입점 계약 |

`client-mobile`은 향후 클라이언트용으로 예약되어 있습니다. 공유 패키지는 안정적인 클라이언트 간 계약을 추출할 필요가 생길 때 추가합니다.

## 상태, 검사, 기존 설치 전환

이 저장소는 소스와 설치 가이드를 제공하며 2026년 10월 2일 기준 GitHub Release는 없습니다. 소스 버전 [`019e405`](https://github.com/ThreeLightStudio/context-os/commit/019e405264b241241fe2fc2bfb6766f450ff613c)의 [CI는 성공](https://github.com/ThreeLightStudio/context-os/actions/runs/32220575284)했습니다. 이 결과가 특정 서비스의 배포, 실제 모델 결과, 기기에서의 수락을 입증하지는 않습니다.

```sh
pnpm verify
```

루트 명령은 저장소 테스트와 각 패키지의 lint·타입 검사·테스트·빌드를 실행합니다. Brain 테스트는 모의 모델 제공자를 사용합니다. Raycast UI를 변경한 경우 재빌드한 확장을 실제 Raycast에서 확인해야 하며 빌드만으로 완료되지 않습니다.

예전 Chrome 빌드를 바꿀 때는 확장 ID를 먼저 확인하세요. 저장소·단축키·허용 origin은 ID에 연결됩니다. 새 origin과 연결을 설정한 뒤 이전 빌드를 비활성화합니다. 두 설치는 같은 내용을 서로 다른 기록 ID로 남길 수 있습니다. 서버는 한 ID의 동일 요청 재시도만 중복 제거합니다. Raycast의 패키지 ID는 `context-os`입니다. **Import Extension**이 의도한 설치를 갱신하는지 확인하고, **Context Settings**와 기록 동작을 검사한 뒤 이전 설치를 제거하세요. 자세한 절차는 [설치 모드](docs/setup-modes.md)와 클라이언트 가이드에 있습니다.

## 라이선스

[MIT](LICENSE).
