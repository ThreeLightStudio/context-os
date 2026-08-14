export interface ContextRecord {
  id: string;
  recordedAt: string;
  receivedAt: string;
  schemaVersion: 1;
  data: {
    kind: "capture";
    content: string;
    source: { client: string; [key: string]: unknown };
    context?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface ContextRecordsPage {
  records: ContextRecord[];
  nextCursor: string | null;
}

export interface ContextSource {
  listRecords(options?: { limit?: number; cursor?: string }): Promise<ContextRecordsPage>;
}

export interface ServerContextClientOptions {
  serverUrl: string;
  apiToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ServerContextClientError extends Error {
  constructor(message: string, public readonly code = "context_server_error", public readonly status?: number) {
    super(message);
    this.name = "ServerContextClientError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isContextRecord(value: unknown): value is ContextRecord {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || typeof value.recordedAt !== "string" || typeof value.receivedAt !== "string") return false;
  if (value.schemaVersion !== 1 || !isObject(value.data)) return false;
  if (value.data.kind !== "capture" || typeof value.data.content !== "string") return false;
  if (!isObject(value.data.source) || typeof value.data.source.client !== "string") return false;
  return value.data.context === undefined || isObject(value.data.context);
}

function isRecordsPage(value: unknown): value is ContextRecordsPage {
  return isObject(value)
    && Array.isArray(value.records)
    && (value.nextCursor === null || typeof value.nextCursor === "string")
    && value.records.every(isContextRecord);
}

function recordsUrl(serverUrl: string, options: { limit?: number; cursor?: string }): string {
  let url: URL;
  try {
    url = new URL(serverUrl.trim());
  } catch {
    throw new ServerContextClientError("CONTEXT_SERVER_URL must be a valid URL", "context_configuration");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServerContextClientError("CONTEXT_SERVER_URL must use http or https", "context_configuration");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/records`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("limit", String(options.limit ?? 50));
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  return url.toString();
}

export class ServerContextClient implements ContextSource {
  private readonly serverUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ServerContextClientOptions) {
    this.serverUrl = options.serverUrl;
    this.apiToken = options.apiToken.trim();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listRecords(options: { limit?: number; cursor?: string } = {}): Promise<ContextRecordsPage> {
    if (!this.apiToken) throw new ServerContextClientError("CONTEXT_SERVER_TOKEN is required", "context_configuration");
    const response = await this.fetchImpl(recordsUrl(this.serverUrl, options), {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${this.apiToken}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((cause) => {
      throw new ServerContextClientError(
        `could not reach server-context: ${cause instanceof Error ? cause.message : "request failed"}`,
        "context_unreachable",
      );
    });

    if (!response.ok) throw new ServerContextClientError(`server-context request failed (${response.status})`, "context_http", response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServerContextClientError("server-context returned invalid JSON", "context_malformed");
    }
    if (!isRecordsPage(body)) throw new ServerContextClientError("server-context returned an invalid records response", "context_malformed");
    return body;
  }
}
