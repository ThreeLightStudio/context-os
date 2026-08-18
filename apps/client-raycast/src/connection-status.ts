export type ConnectionTarget = "unconfigured" | "local" | "cloudflare";

type ConnectionMessageKey =
  | "connection.required"
  | "connection.requiredDetail"
  | "connection.local"
  | "connection.localDetail"
  | "connection.invalidUrl"
  | "connection.invalidUrlDetail"
  | "connection.cloudflare"
  | "connection.cloudflareDetail";
type ConnectionTranslate = (key: ConnectionMessageKey) => string;

const defaultConnectionMessages: Record<ConnectionMessageKey, string> = {
  "connection.required": "Setup required",
  "connection.requiredDetail": "Enter the Context Server URL and read/write API token in Raycast Preferences.",
  "connection.local": "Local Context Server",
  "connection.localDetail":
    "Connects to the Worker/D1 on this device. Use the same URL and token in Chrome to share records.",
  "connection.invalidUrl": "Check URL",
  "connection.invalidUrlDetail": "The Context Server URL must use http or https.",
  "connection.cloudflare": "Cloudflare D1 or external Context Server",
  "connection.cloudflareDetail": "Uses the Context Server URL and token deployed to a Cloudflare Worker.",
};

export type ContextConnectionStatus = {
  target: ConnectionTarget;
  title: string;
  detail: string;
};

function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLocaleLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

export function describeContextConnection(
  serverUrl: string,
  hasApiToken: boolean,
  t?: ConnectionTranslate,
): ContextConnectionStatus {
  const translate = t ?? ((key: ConnectionMessageKey) => defaultConnectionMessages[key]);
  if (!serverUrl || !hasApiToken) {
    return {
      target: "unconfigured",
      title: translate("connection.required"),
      detail: translate("connection.requiredDetail"),
    };
  }

  try {
    const url = new URL(serverUrl);
    if (isLoopbackHost(url.hostname)) {
      return {
        target: "local",
        title: translate("connection.local"),
        detail: translate("connection.localDetail"),
      };
    }
  } catch {
    return {
      target: "unconfigured",
      title: translate("connection.invalidUrl"),
      detail: translate("connection.invalidUrlDetail"),
    };
  }

  return {
    target: "cloudflare",
    title: translate("connection.cloudflare"),
    detail: translate("connection.cloudflareDetail"),
  };
}
