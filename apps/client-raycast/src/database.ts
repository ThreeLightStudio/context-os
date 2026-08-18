import { getPreferenceValues } from "@raycast/api";

export const contextEventPrefix = "<!-- context-os:event:v1";

const recordsPageSize = 100;

interface RecordsPreferences {
  serverUrl?: string;
  apiToken?: string;
}

export interface Capture {
  id: string;
  content: string;
  capturedAt: string;
  createdAt: string;
}

interface ApiRecord {
  id: string;
  recordedAt: string;
  receivedAt: string;
  schemaVersion: 1;
  data: {
    kind: "capture";
    content: string;
  };
}

interface RecordsPage {
  records: ApiRecord[];
  nextCursor: string | null;
}

function describeReason(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

async function recordsApiError(response: Response) {
  const fallback = response.statusText || "Request failed";

  try {
    const body = (await response.json()) as { error?: unknown };
    const message = typeof body.error === "string" && body.error.trim() ? body.error : fallback;
    return new Error(`Records API request failed (${response.status}): ${message}`);
  } catch {
    return new Error(`Records API request failed (${response.status}): ${fallback}`);
  }
}

async function recordsFetch(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (reason) {
    throw new Error(`Records API network error: ${describeReason(reason)}`);
  }
}

function toCapture(record: ApiRecord): Capture {
  return {
    id: record.id,
    content: record.data.content,
    capturedAt: record.recordedAt,
    createdAt: record.recordedAt,
  };
}

function newestFirst(left: Capture, right: Capture) {
  return right.capturedAt.localeCompare(left.capturedAt) || right.id.localeCompare(left.id);
}

function oldestFirst(left: Capture, right: Capture) {
  return left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id);
}

function recordsConfig() {
  const preferences = getPreferenceValues<RecordsPreferences>();
  const serverUrl = preferences.serverUrl?.trim() ?? "";
  const apiToken = preferences.apiToken?.trim() ?? "";

  if (!serverUrl || !apiToken) {
    throw new Error("Set the Context Server URL and API token in Raycast Preferences.");
  }

  let url: URL;
  try {
    url = new URL(serverUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/records`;
    url.search = "";
    url.hash = "";
  } catch {
    throw new Error("Context Server URL must be a valid http(s) URL.");
  }

  return { url, apiToken };
}

function authenticatedRequest(apiToken: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiToken}`);
  return { ...init, headers };
}

async function listRecordsPage(cursor?: string): Promise<RecordsPage> {
  const { url, apiToken } = recordsConfig();
  url.searchParams.set("limit", String(recordsPageSize));
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await recordsFetch(
    url.toString(),
    authenticatedRequest(apiToken, { headers: { accept: "application/json" } }),
  );
  if (!response.ok) throw await recordsApiError(response);

  try {
    const page = (await response.json()) as RecordsPage;
    if (!Array.isArray(page.records) || (page.nextCursor !== null && typeof page.nextCursor !== "string")) {
      throw new Error("Records API returned an invalid list response");
    }
    return page;
  } catch (reason) {
    if (reason instanceof Error && reason.message === "Records API returned an invalid list response") throw reason;
    throw new Error(`Records API returned invalid JSON: ${describeReason(reason)}`);
  }
}

async function listAllRecords() {
  const records: Capture[] = [];
  let cursor: string | undefined;

  do {
    const page = await listRecordsPage(cursor);
    records.push(...page.records.map(toCapture));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return records;
}

export async function saveCapture(id: string, content: string, capturedAt: string, inputMethod = "capture") {
  const { url, apiToken } = recordsConfig();
  const response = await recordsFetch(
    url.toString(),
    authenticatedRequest(apiToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        recordedAt: capturedAt,
        schemaVersion: 1,
        data: {
          kind: "capture",
          content,
          source: { client: "raycast", inputMethod },
        },
      }),
    }),
  );

  if (response.status === 201 || response.status === 200) return;
  throw await recordsApiError(response);
}

export async function listRecentCaptures(): Promise<Capture[]> {
  const captures: Capture[] = [];
  let cursor: string | undefined;

  do {
    const page = await listRecordsPage(cursor);
    captures.push(...page.records.map(toCapture).filter((capture) => !capture.content.startsWith(contextEventPrefix)));
    if (captures.length >= recordsPageSize) break;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return captures.sort(newestFirst).slice(0, recordsPageSize);
}

export async function listAllRecentCaptures(): Promise<Capture[]> {
  const page = await listRecordsPage();
  return page.records.map(toCapture).sort(newestFirst);
}

export async function listAllCaptures(): Promise<Capture[]> {
  return (await listAllRecords()).sort(oldestFirst);
}

export async function listContextEventCaptures(): Promise<Capture[]> {
  return (await listAllRecords()).filter((capture) => capture.content.startsWith(contextEventPrefix)).sort(oldestFirst);
}
