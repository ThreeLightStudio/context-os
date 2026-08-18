import type { ContextRecord, ContextRecordsPage, CreateRecordResponse, GetRecordResponse } from "./types.js";

export type ContextApiErrorCode =
  | "context_configuration"
  | "context_authentication"
  | "context_forbidden"
  | "context_unreachable"
  | "context_timeout"
  | "context_rate_limited"
  | "context_malformed"
  | "context_validation"
  | "context_conflict"
  | "context_not_found"
  | "context_http";

export class ContextApiError extends Error {
  constructor(
    message: string,
    public readonly code: ContextApiErrorCode,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ContextApiError";
  }
}

export type ContextApiClientOptions = {
  serverUrl: string;
  apiToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isContextRecord(value: unknown): value is ContextRecord {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || typeof value.recordedAt !== "string" || typeof value.receivedAt !== "string") return false;
  if (value.schemaVersion !== 1 || !isObject(value.data)) return false;
  if (value.data.kind !== "capture" || typeof value.data.content !== "string") return false;
  if (!isObject(value.data.source) || typeof value.data.source.client !== "string") return false;
  if (value.data.contextId !== undefined && typeof value.data.contextId !== "string") return false;
  if (value.data.revision !== undefined && (typeof value.data.revision !== "number" || !Number.isInteger(value.data.revision) || value.data.revision < 1)) return false;
  if (value.data.previousRecordId !== undefined && typeof value.data.previousRecordId !== "string") return false;
  return value.data.context === undefined || isObject(value.data.context);
}

function isRecordsPage(value: unknown): value is ContextRecordsPage {
  return isObject(value)
    && Array.isArray(value.records)
    && (value.nextCursor === null || typeof value.nextCursor === "string")
    && value.records.every(isContextRecord);
}

function isCreateRecordResponse(value: unknown): value is CreateRecordResponse {
  return isObject(value)
    && typeof value.idempotent === "boolean"
    && isContextRecord(value.record);
}

function isGetRecordResponse(value: unknown): value is GetRecordResponse {
  return isObject(value) && isContextRecord(value.record);
}

function serverUrlObject(serverUrl: string): URL {
  let url: URL;
  try {
    url = new URL(serverUrl.trim());
  } catch {
    throw new ContextApiError("CONTEXT_SERVER_URL must be a valid URL", "context_configuration");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ContextApiError("CONTEXT_SERVER_URL must use http or https", "context_configuration");
  }
  return url;
}

function recordsUrl(serverUrl: string, options: { limit: number; cursor?: string }): string {
  const url = serverUrlObject(serverUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/records`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("limit", String(options.limit));
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  return url.toString();
}

function recordUrl(serverUrl: string, id: string): string {
  const url = serverUrlObject(serverUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/records/${encodeURIComponent(id)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function apiErrorForStatus(status: number): ContextApiError {
  if (status === 401) return new ContextApiError("server-context authentication failed", "context_authentication", status);
  if (status === 403) return new ContextApiError("server-context token lacks the required scope", "context_forbidden", status);
  if (status === 400) return new ContextApiError("server-context rejected the request", "context_validation", status);
  if (status === 409) return new ContextApiError("server-context rejected a conflicting record", "context_conflict", status);
  if (status === 404) return new ContextApiError("server-context record was not found", "context_not_found", status);
  if (status === 429) return new ContextApiError("server-context rate limit exceeded", "context_rate_limited", status, true);
  return new ContextApiError(`server-context request failed (${status})`, "context_http", status, status >= 500);
}

export class ContextApiClient {
  private readonly serverUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ContextApiClientOptions) {
    this.serverUrl = options.serverUrl;
    this.apiToken = options.apiToken.trim();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listRecords(options: { limit?: number; cursor?: string } = {}): Promise<ContextRecordsPage> {
    return this.request("GET", recordsUrl(this.serverUrl, { limit: options.limit ?? 100, cursor: options.cursor }), undefined, isRecordsPage);
  }

  async getRecord(id: string): Promise<ContextRecord> {
    const response = await this.request("GET", recordUrl(this.serverUrl, id), undefined, isGetRecordResponse);
    return response.record;
  }

  async listAllRecords(): Promise<ContextRecord[]> {
    const records: ContextRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listRecords({ limit: 100, cursor });
      records.push(...page.records);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return records;
  }

  async createRecord(record: ContextRecord): Promise<CreateRecordResponse> {
    const { receivedAt: _receivedAt, ...payload } = record;
    return this.request("POST", recordsUrl(this.serverUrl, { limit: 100 }), payload, isCreateRecordResponse);
  }

  private async request<T>(method: "GET" | "POST", url: string, body: unknown | undefined, validate: (value: unknown) => value is T): Promise<T> {
    if (!this.apiToken) throw new ContextApiError("CONTEXT_SERVER_TOKEN is required", "context_configuration");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let timedOut = false;
    const timeoutAbort = () => { timedOut = true; };
    controller.signal.addEventListener("abort", timeoutAbort, { once: true });

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiToken}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      }).catch((cause) => {
        if (timedOut) throw new ContextApiError("server-context request timed out", "context_timeout", undefined, true);
        throw new ContextApiError(
          `could not reach server-context: ${cause instanceof Error ? cause.message : "request failed"}`,
          "context_unreachable",
          undefined,
          true,
        );
      });

      if (!response.ok) throw apiErrorForStatus(response.status);

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new ContextApiError("server-context returned invalid JSON", "context_malformed", response.status);
      }

      if (validate(parsed)) return parsed;
      throw new ContextApiError("server-context returned an invalid response", "context_malformed", response.status);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", timeoutAbort);
    }
  }
}
