# 공개 저장소 전환 체크리스트

이 저장소의 기존 Git 이력은 새 공개 저장소로 옮기지 않습니다. 정리된 소스 트리만 새 루트 커밋으로 시작하면 이전 commit metadata와 연결 불가 Git 객체가 함께 공개되지 않습니다.

## 공개 전 점검

정리된 release commit을 기준으로 개인 Worker URL·개인 handle·비밀값이 없는지 확인합니다.

```sh
rg -n -i 'workers\.dev|gh[pousr]_|sk-[A-Za-z0-9_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY' . \
  --hidden --glob '!node_modules/**' --glob '!.git/**'
pnpm verify
```

`ThreeLightStudio`와 Chrome 샘플 데이터의 `MapBridge`는 의도적으로 유지합니다. 실제 token, `.env`, `.dev.vars`, `wrangler.jsonc`, `.wrangler` 데이터는 결과에 포함되면 안 됩니다.

Raycast Store에 공개할 경우 `ThreeLightStudio` 이름의 Raycast publisher
account가 먼저 존재해야 합니다. 그 계정으로 manifest 검증을 통과하기 전에는
Store publish를 진행하지 않습니다. 이 확인은 Store 배포 전용이므로, 공개
소스의 기본 검증에는 포함하지 않습니다. Store 배포 직전에만 다음 명령을 실행합니다.

```sh
pnpm --filter context-os lint:store
```

manifest의 `author`는 확장을 사용하는 개인이 아니라 Raycast Store 게시자를
뜻합니다. 따라서 Custom Import·로컬 사용·Cloudflare 설정을 하는 사용자는 이
값을 변경하지 않으며 Git 변경도 생기지 않습니다. 다른 사람이 자신의 fork를
Store에 게시할 경우에만, 그 fork의 등록된 Raycast username으로 `author`를
바꾸고 해당 게시자 표기를 fork에 커밋합니다.

## 새 저장소 만들기

검증한 release commit에서 `.git` 없는 아카이브를 만들고, 그 디렉터리에서 새 저장소를 초기화합니다.

```sh
git archive --format=tar <sanitized-release-commit> | tar -x -C ../context-os-public
cd ../context-os-public
git init
git add .
git commit -m "feat: open-source Context OS"
```

이후 GitHub의 `ThreeLightStudio` 조직에서 새 공개 저장소를 만든 후 새 remote만 추가해 push합니다. 기존 저장소의 remote, branches, tags, reflog, `.git` 디렉터리를 복사하거나 force-push하지 않습니다.
