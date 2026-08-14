export type ConnectionTarget = "unconfigured" | "local" | "cloudflare";

export type ContextConnectionStatus = {
  target: ConnectionTarget;
  title: string;
  detail: string;
};

function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLocaleLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

export function describeContextConnection(serverUrl: string, hasApiToken: boolean): ContextConnectionStatus {
  if (!serverUrl || !hasApiToken) {
    return {
      target: "unconfigured",
      title: "설정 필요",
      detail: "Context Server URL과 read/write API token을 Raycast Preferences에 입력해 주세요.",
    };
  }

  try {
    const url = new URL(serverUrl);
    if (isLoopbackHost(url.hostname)) {
      return {
        target: "local",
        title: "로컬 Context Server",
        detail: "이 기기의 Worker/D1에 연결합니다. Chrome에도 같은 URL과 token을 설정하면 기록을 공유할 수 있습니다.",
      };
    }
  } catch {
    return {
      target: "unconfigured",
      title: "URL 확인 필요",
      detail: "Context Server URL은 http 또는 https URL이어야 합니다.",
    };
  }

  return {
    target: "cloudflare",
    title: "Cloudflare D1 또는 외부 Context Server",
    detail: "Cloudflare Worker에 배포한 Context Server URL과 token을 사용합니다.",
  };
}
