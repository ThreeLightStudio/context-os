import { authenticate, hasScope, type AuthenticatedToken, type TokenScope } from "./auth";
import { MAX_JSON_BYTES, ValidationError, parseCreateRecord } from "./record";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_POST?: RateLimit;
  RATE_LIMIT_GET?: RateLimit;
  RATE_LIMIT_DELETE?: RateLimit;
}

type StoredRecord = { id: string; recorded_at: string; received_at: string; schema_version: number; data: string };
const securityHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  vary: "Origin",
};

class AuthError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
  }
}

class RateLimitError extends Error {}

function allowedOrigins(env: Env): Set<string> {
  return new Set((env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
}

function isOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  return origin === null || allowedOrigins(env).has(origin);
}

function responseHeaders(request: Request, env: Env): Headers {
  const headers = new Headers(securityHeaders);
  const origin = request.headers.get("origin");
  if (origin !== null && allowedOrigins(env).has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    headers.set("access-control-allow-headers", "content-type, authorization");
    headers.set("access-control-max-age", "600");
  }
  return headers;
}

const json = (body: unknown, request: Request, env: Env, init: ResponseInit = {}) => {
  const headers = responseHeaders(request, env);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
  return new Response(JSON.stringify(body), { ...init, headers });
};
const error = (status: number, message: string, request: Request, env: Env, headers?: HeadersInit) => json({ error: message }, request, env, { status, headers });

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ValidationError("content-type must be application/json");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_JSON_BYTES)) throw new ValidationError("request body exceeds 128KB");
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_JSON_BYTES) throw new ValidationError("request body exceeds 128KB");
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new ValidationError("request body must be valid JSON"); }
}

function toApiRecord(row: StoredRecord) {
  return { id: row.id, recordedAt: row.recorded_at, receivedAt: row.received_at, schemaVersion: row.schema_version, data: JSON.parse(row.data) };
}
function encodeCursor(row: StoredRecord): string { return btoa(JSON.stringify([row.recorded_at, row.id])); }
function decodeCursor(value: string | null): [string, string] | undefined {
  if (!value) return undefined;
  try { const parsed = JSON.parse(atob(value)); return Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string" ? [parsed[0], parsed[1]] : undefined; }
  catch { return undefined; }
}

function rateLimitBinding(method: string, env: Env): RateLimit | undefined {
  if (method === "POST") return env.RATE_LIMIT_POST;
  if (method === "GET") return env.RATE_LIMIT_GET;
  if (method === "DELETE") return env.RATE_LIMIT_DELETE;
  return undefined;
}

async function enforceRateLimit(request: Request, method: string, env: Env): Promise<void> {
  const binding = rateLimitBinding(method, env);
  if (!binding) return;
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
  const outcome = await binding.limit({ key });
  if (!outcome.success) throw new RateLimitError();
}

async function requireScope(request: Request, env: Env, scope: TokenScope): Promise<AuthenticatedToken> {
  const token = await authenticate(request, env.DB);
  if (!token) throw new AuthError(401, "authentication required");
  if (!hasScope(token, scope)) throw new AuthError(403, "insufficient scope");
  return token;
}

async function createRecord(request: Request, env: Env): Promise<Response> {
  const record = parseCreateRecord(await readJson(request));
  const receivedAt = new Date().toISOString();
  const data = JSON.stringify(record.data);
  const insert = await env.DB.prepare("INSERT OR IGNORE INTO records (id, recorded_at, received_at, schema_version, data) VALUES (?, ?, ?, ?, ?)")
    .bind(record.id, record.recordedAt, receivedAt, record.schemaVersion, data).run();
  if ((insert.meta.changes ?? 0) === 1) return json({ record: { id: record.id, recordedAt: record.recordedAt, receivedAt, schemaVersion: record.schemaVersion, data: record.data }, idempotent: false }, request, env, { status: 201 });
  const existing = await env.DB.prepare("SELECT id, recorded_at, received_at, schema_version, data FROM records WHERE id = ?").bind(record.id).first<StoredRecord>();
  if (!existing) return error(500, "record insert could not be confirmed", request, env);
  if (existing.recorded_at !== record.recordedAt || existing.schema_version !== record.schemaVersion || existing.data !== data) return error(409, "id is already used by a different record", request, env);
  return json({ record: toApiRecord(existing), idempotent: true }, request, env, { status: 200 });
}

async function listRecords(url: URL, env: Env, request: Request): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) return error(400, "limit must be an integer from 1 to 100", request, env);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.has("cursor") && !cursor) return error(400, "cursor is invalid", request, env);
  const query = cursor
    ? env.DB.prepare("SELECT id, recorded_at, received_at, schema_version, data FROM records WHERE julianday(recorded_at) < julianday(?) OR (julianday(recorded_at) = julianday(?) AND id < ?) ORDER BY julianday(recorded_at) DESC, id DESC LIMIT ?").bind(cursor[0], cursor[0], cursor[1], requestedLimit + 1)
    : env.DB.prepare("SELECT id, recorded_at, received_at, schema_version, data FROM records ORDER BY julianday(recorded_at) DESC, id DESC LIMIT ?").bind(requestedLimit + 1);
  const { results } = await query.all<StoredRecord>();
  const hasMore = results.length > requestedLimit;
  const rows = hasMore ? results.slice(0, -1) : results;
  return json({ records: rows.map(toApiRecord), nextCursor: hasMore ? encodeCursor(rows.at(-1)!) : null }, request, env);
}

async function deleteRecord(id: string, env: Env, request: Request): Promise<Response> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return error(400, "id must be a UUID", request, env);
  const result = await env.DB.prepare("DELETE FROM records WHERE id = ?").bind(id.toLowerCase()).run();
  if ((result.meta.changes ?? 0) === 0) return error(404, "record not found", request, env);
  return new Response(null, { status: 204, headers: responseHeaders(request, env) });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const isCollection = url.pathname === "/v1/records";
    const recordId = url.pathname.match(/^\/v1\/records\/([^/]+)$/)?.[1];
    try {
      if (isCollection && request.method === "OPTIONS") {
        if (!isOriginAllowed(request, env)) return error(403, "origin is not allowed", request, env);
        return new Response(null, {
          status: 204,
          headers: responseHeaders(request, env),
        });
      }
      if (!isOriginAllowed(request, env)) return error(403, "origin is not allowed", request, env);
      if (isCollection && request.method === "POST") {
        await enforceRateLimit(request, "POST", env);
        await requireScope(request, env, "write");
        return await createRecord(request, env);
      }
      if (isCollection && request.method === "GET") {
        await enforceRateLimit(request, "GET", env);
        await requireScope(request, env, "read");
        return await listRecords(url, env, request);
      }
      if (recordId && request.method === "DELETE") {
        await enforceRateLimit(request, "DELETE", env);
        await requireScope(request, env, "delete");
        return await deleteRecord(recordId, env, request);
      }
      return error(404, "not found", request, env);
    } catch (cause) {
      if (cause instanceof AuthError) {
        const headers = cause.status === 401 ? { "www-authenticate": "Bearer" } : undefined;
        return error(cause.status, cause.message, request, env, headers);
      }
      if (cause instanceof RateLimitError) return error(429, "rate limit exceeded", request, env, { "retry-after": "60" });
      if (cause instanceof ValidationError) return error(400, cause.message, request, env);
      console.error(cause);
      return error(500, "internal server error", request, env);
    }
  },
} satisfies ExportedHandler<Env>;
