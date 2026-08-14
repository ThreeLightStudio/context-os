# Context Shelf

Local-first Chrome extension for saving and resuming browser work contexts by
project.

## MVP

- Side panel daily driver
- Popup quick actions
- Options/library page
- Chrome MV3 background service worker
- Local-first project/session/URL memory storage
- Import/export backup
- Mock free-limit and license activation surfaces

## Development

```bash
# Run from the monorepo root
pnpm install
pnpm --filter context-shelf dev
pnpm --filter context-shelf build
```

Load `dist/` as an unpacked extension in Chrome.

새 설치에서는 먼저 **로컬로 시작** 또는 **Cloudflare D1 연결**을 선택합니다.
Chrome만 사용할 때는 서버 없이 로컬로 시작할 수 있습니다. Raycast와 기록을
공유하려면 연결 설정에서 로컬 `http://127.0.0.1:8787` 또는 내 Cloudflare
Worker URL과 read/write API token을 함께 입력하세요. token은 확장 프로그램
로컬 저장소에만 보관되며 백업 데이터나 화면에 포함되지 않습니다.

동일한 확장 ID에서 `⌘⇧L`로 사이드 패널을 닫았다 열어도 선택한 모드와 연결
설정은 유지됩니다. 다만 다른 경로에서 새 unpacked extension을 로드해 ID가
달라지면 Chrome 저장소도 별도로 분리됩니다. Context Server 주소와 token은
번들에 포함하지 않으며, 각 설치에서 직접 입력합니다.

`저장된 설정을 열지 못했습니다` 화면이 보이면 새 보관 방식을 선택하지 말고
**다시 시도**하세요. 이 화면은 Chrome 저장소 오류가 기존 연결과 기록을
덮어쓰지 않도록 막습니다. 과거 버전이 이미 지운 Cloudflare 주소나 token은
자동 복구할 수 없으므로 한 번 다시 입력해야 합니다.

전체 로컬 Worker/D1 실행과 Cloudflare D1 배포 절차는
[`docs/setup-modes.md`](../../docs/setup-modes.md)를 따르세요.

## Daily Summary

Open the Side Panel and choose `오늘 요약` in the header. The extension sends
the selected local calendar date and the browser's IANA timezone to the local
Brain Server, which reads Context records from `server-context` and returns a
structured summary.

The Brain Server address defaults to `http://127.0.0.1:8788`. Configure it in
`연결 설정` under `Brain Server`; a Brain API token is optional when the local
server runs without `BRAIN_API_TOKEN`.

For Chrome requests, start `server-brain` with the unpacked extension origin
in `BRAIN_ALLOWED_ORIGINS`, for example:

```sh
BRAIN_ALLOWED_ORIGINS=chrome-extension://<extension-id> \
CONTEXT_SERVER_URL=http://127.0.0.1:8787 \
CONTEXT_SERVER_TOKEN=ctx_<token> \
BRAIN_MODEL=<ollama-model> \
pnpm --filter server-brain dev
```

The Daily Summary result is displayed in the Side Panel and is not persisted
as a separate Context record yet.
