export const DEFAULT_RECORDS_PAGE_SIZE = 50;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export type RemoteRecordsErrorCode =
  | "configuration"
  | "unauthorized"
  | "forbidden"
  | "rate-limited"
  | "timeout"
  | "network"
  | "malformed"
  | "http"
  | "aborted";

export class RemoteRecordsError extends Error {
  public readonly code: RemoteRecordsErrorCode;
  public readonly status?: number;

  constructor(code: RemoteRecordsErrorCode, message: string, status?: number) {
    super(message);
    this.name = "RemoteRecordsError";
    this.code = code;
    this.status = status;
  }
}

export interface RemoteRecordSource {
  client: string;
  [key: string]: unknown;
}

export interface RemoteRecordData {
  kind: "capture";
  content: string;
  source: RemoteRecordSource;
  context: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RemoteRecord {
  id: string;
  recordedAt: string;
  receivedAt: string;
  schemaVersion: 1;
  data: RemoteRecordData;
}

export interface RecordsPage {
  records: RemoteRecord[];
  nextCursor: string | null;
}

export interface FetchRemoteRecordsOptions {
  serverUrl: string;
  apiToken: string;
  cursor?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRemoteRecord(value: unknown): value is RemoteRecord {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.recordedAt !== "string" || value.recordedAt.length === 0) return false;
  if (typeof value.receivedAt !== "string" || value.receivedAt.length === 0) return false;
  if (value.schemaVersion !== 1 || !isObject(value.data)) return false;
  if (value.data.kind !== "capture" || typeof value.data.content !== "string") return false;
  if (!isObject(value.data.source) || typeof value.data.source.client !== "string") return false;
  return isObject(value.data.context);
}

function isRecordsPage(value: unknown): value is RecordsPage {
  if (!isObject(value) || !Array.isArray(value.records)) return false;
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") return false;
  return value.records.every(isRemoteRecord);
}

function recordsEndpoint(serverUrl: string) {
  const trimmedUrl = serverUrl.trim();
  if (!trimmedUrl) {
    throw new RemoteRecordsError("configuration", "Set serverUrl in Raycast Preferences.");
  }

  try {
    const url = new URL(trimmedUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/records`;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    throw new RemoteRecordsError("configuration", "serverUrl must be a valid http(s) URL.");
  }
}

function describeHttpError(status: number) {
  if (status === 401) {
    return new RemoteRecordsError(
      "unauthorized",
      "401 Unauthorized. Set a valid Context Server API token in Raycast Preferences.",
      status,
    );
  }
  if (status === 403) {
    return new RemoteRecordsError(
      "forbidden",
      "403 Forbidden. The token must have read scope. Update it in Raycast Preferences.",
      status,
    );
  }
  if (status === 429) {
    return new RemoteRecordsError("rate-limited", "429 Too Many Requests. Wait a moment and try again.", status);
  }
  return new RemoteRecordsError("http", `Context Server request failed (${status}).`, status);
}

async function fetchWithTimeout(
  url: string,
  apiToken: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromOutside = () => controller.abort();

  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromOutside, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      signal: controller.signal,
    });
  } catch {
    if (timedOut) {
      throw new RemoteRecordsError("timeout", "The Context Server request timed out. Try again.");
    }
    if (externalSignal?.aborted) {
      throw new RemoteRecordsError("aborted", "The Context Server request was cancelled.");
    }
    throw new RemoteRecordsError("network", "Could not reach the Context Server. Check the URL and network.");
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromOutside);
  }
}

export async function fetchRemoteRecordsPage(options: FetchRemoteRecordsOptions): Promise<RecordsPage> {
  const { serverUrl, apiToken } = options;
  if (!apiToken.trim()) {
    throw new RemoteRecordsError("configuration", "Set the Context Server API token in Raycast Preferences.");
  }

  const url = recordsEndpoint(serverUrl);
  url.searchParams.set("limit", String(DEFAULT_RECORDS_PAGE_SIZE));
  if (options.cursor) url.searchParams.set("cursor", options.cursor);

  const response = await fetchWithTimeout(
    url.toString(),
    apiToken.trim(),
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    options.signal,
  );

  if (!response.ok) throw describeHttpError(response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RemoteRecordsError("malformed", "The Context Server returned invalid JSON.");
  }

  if (!isRecordsPage(body)) {
    throw new RemoteRecordsError("malformed", "The Context Server returned an invalid records response.");
  }

  return body;
}

export async function checkRemoteRecordsConnection(options: Omit<FetchRemoteRecordsOptions, "cursor">): Promise<void> {
  const { serverUrl, apiToken } = options;
  if (!apiToken.trim()) {
    throw new RemoteRecordsError("configuration", "Set the Context Server API token in Raycast Preferences.");
  }

  const url = recordsEndpoint(serverUrl);
  url.searchParams.set("limit", "1");
  const response = await fetchWithTimeout(
    url.toString(),
    apiToken.trim(),
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    options.signal,
  );

  if (!response.ok) throw describeHttpError(response.status);
}
