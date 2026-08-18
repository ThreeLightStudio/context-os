export const MAX_JSON_BYTES = 128 * 1024;
export const MAX_CAPTURE_BYTES = 32 * 1024;
const MAX_URL_BYTES = 8 * 1024;
const MAX_SHORT_TEXT_BYTES = 1024;
const MAX_SELECTED_TEXT_BYTES = 64 * 1024;

export type CaptureData = {
  kind: "capture";
  content: string;
  contextId?: string;
  revision?: number;
  previousRecordId?: string;
  source: {
    client: "chrome" | "desktop" | "mobile" | "raycast";
    clientVersion?: string;
    deviceId?: string;
    inputMethod?: string;
  };
  context?: {
    browser?: { url?: string; title?: string; selectedText?: string };
    desktop?: { activeApplication?: string; windowTitle?: string };
    mobile?: { sharedUrl?: string; sharedTitle?: string; captureSurface?: string };
  };
};

export type CreateRecordInput = {
  id: string;
  recordedAt: string;
  schemaVersion?: number;
  data: CaptureData;
};

export type NormalizedRecord = {
  id: string;
  recordedAt: string;
  schemaVersion: 1;
  data: CaptureData;
};

export class ValidationError extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ValidationError(`${name}.${key} is not allowed`);
  }
}

function requiredString(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string`);
  }
  if (byteLength(value) > maxBytes) throw new ValidationError(`${name} is too large`);
  return value;
}

function optionalString(value: unknown, name: string, maxBytes: number): string | undefined {
  if (value === undefined) return undefined;
  if (value === "") return undefined;
  return requiredString(value, name, maxBytes);
}

function optionalUuid(value: unknown, name: string): string | undefined {
  const normalized = optionalString(value, name, 64);
  if (normalized === undefined) return undefined;
  if (!uuidPattern.test(normalized)) throw new ValidationError(`${name} must be a UUID`);
  return normalized.toLowerCase();
}

function optionalRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 1_000_000) {
    throw new ValidationError("data.revision must be an integer from 1 to 1000000");
  }
  return Number(value);
}

function omitEmpty<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined && item !== "");
  return entries.length === 0 ? undefined : Object.fromEntries(entries) as T;
}

function parseContext(input: unknown): CaptureData["context"] {
  if (input === undefined) return undefined;
  const context = object(input, "data.context");
  onlyKeys(context, ["browser", "desktop", "mobile"], "data.context");
  const result: NonNullable<CaptureData["context"]> = {};
  if (context.browser !== undefined) {
    const browser = object(context.browser, "data.context.browser");
    onlyKeys(browser, ["url", "title", "selectedText"], "data.context.browser");
    const clean = omitEmpty({
      url: optionalString(browser.url, "data.context.browser.url", MAX_URL_BYTES),
      title: optionalString(browser.title, "data.context.browser.title", MAX_SHORT_TEXT_BYTES),
      selectedText: optionalString(browser.selectedText, "data.context.browser.selectedText", MAX_SELECTED_TEXT_BYTES),
    });
    if (clean) result.browser = clean;
  }
  if (context.desktop !== undefined) {
    const desktop = object(context.desktop, "data.context.desktop");
    onlyKeys(desktop, ["activeApplication", "windowTitle"], "data.context.desktop");
    const clean = omitEmpty({
      activeApplication: optionalString(desktop.activeApplication, "data.context.desktop.activeApplication", MAX_SHORT_TEXT_BYTES),
      windowTitle: optionalString(desktop.windowTitle, "data.context.desktop.windowTitle", MAX_SHORT_TEXT_BYTES),
    });
    if (clean) result.desktop = clean;
  }
  if (context.mobile !== undefined) {
    const mobile = object(context.mobile, "data.context.mobile");
    onlyKeys(mobile, ["sharedUrl", "sharedTitle", "captureSurface"], "data.context.mobile");
    const clean = omitEmpty({
      sharedUrl: optionalString(mobile.sharedUrl, "data.context.mobile.sharedUrl", MAX_URL_BYTES),
      sharedTitle: optionalString(mobile.sharedTitle, "data.context.mobile.sharedTitle", MAX_SHORT_TEXT_BYTES),
      captureSurface: optionalString(mobile.captureSurface, "data.context.mobile.captureSurface", MAX_SHORT_TEXT_BYTES),
    });
    if (clean) result.mobile = clean;
  }
  return omitEmpty(result);
}

export function parseCreateRecord(input: unknown): NormalizedRecord {
  const payload = object(input, "payload");
  onlyKeys(payload, ["id", "recordedAt", "schemaVersion", "data"], "payload");
  const id = requiredString(payload.id, "id", 64);
  if (!uuidPattern.test(id)) throw new ValidationError("id must be a UUID generated by the client");
  const recordedAt = requiredString(payload.recordedAt, "recordedAt", 64);
  if (Number.isNaN(Date.parse(recordedAt))) throw new ValidationError("recordedAt must be an ISO-8601 timestamp");
  // Store one canonical UTC representation so records from different clients
  // and offsets can be compared consistently.
  const normalizedRecordedAt = new Date(recordedAt).toISOString();
  if (payload.schemaVersion !== undefined && payload.schemaVersion !== 1) {
    throw new ValidationError("schemaVersion must be 1");
  }
  const data = object(payload.data, "data");
  onlyKeys(data, ["kind", "content", "contextId", "revision", "previousRecordId", "source", "context"], "data");
  if (data.kind !== "capture") throw new ValidationError("data.kind must be capture");
  const source = object(data.source, "data.source");
  onlyKeys(source, ["client", "clientVersion", "deviceId", "inputMethod"], "data.source");
  if (!["chrome", "desktop", "mobile", "raycast"].includes(String(source.client))) {
    throw new ValidationError("data.source.client is invalid");
  }
  const sourceOptional = omitEmpty({
    clientVersion: optionalString(source.clientVersion, "data.source.clientVersion", MAX_SHORT_TEXT_BYTES),
    deviceId: optionalString(source.deviceId, "data.source.deviceId", MAX_SHORT_TEXT_BYTES),
    inputMethod: optionalString(source.inputMethod, "data.source.inputMethod", MAX_SHORT_TEXT_BYTES),
  });
  const contextId = optionalUuid(data.contextId, "data.contextId");
  const revision = optionalRevision(data.revision);
  const previousRecordId = optionalUuid(data.previousRecordId, "data.previousRecordId");
  if ((revision !== undefined || previousRecordId !== undefined) && contextId === undefined) {
    throw new ValidationError("data.contextId is required for revision metadata");
  }
  const normalizedData: CaptureData = {
    kind: "capture",
    content: requiredString(data.content, "data.content", MAX_CAPTURE_BYTES),
    ...(contextId ? { contextId } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(previousRecordId ? { previousRecordId } : {}),
    source: {
      client: source.client as CaptureData["source"]["client"],
      ...(sourceOptional ?? {}),
    },
    ...(() => {
      const context = parseContext(data.context);
      return context ? { context } : {};
    })(),
  };
  return { id: id.toLowerCase(), recordedAt: normalizedRecordedAt, schemaVersion: 1, data: normalizedData };
}
