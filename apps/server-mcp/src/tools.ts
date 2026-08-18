import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { ContextApiClient, ContextApiError } from "./context-client.js";
import { buildWorkState, contextEventPrefix, workNameMatches } from "./events.js";
import { normalizeRecord } from "./normalize.js";
import type { McpConfig } from "./config.js";
import type { ContextRecord, McpContextType, Work } from "./types.js";

const MAX_CAPTURE_BYTES = 32 * 1024;
const encoder = new TextEncoder();
const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false };
export const mcpInstructions = "Context OS is append-only. Read tools restore Context; create_context and update_context write only when read-write mode is enabled. update_context creates a new revision and never modifies an existing record. Never invent missing Work or context, and never log tokens or record content.";

export const canonicalReadToolNames = ["search_context", "get_context", "get_recent_contexts", "get_active_context"] as const;
export const canonicalWriteToolNames = ["create_context", "update_context"] as const;

type ToolError = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    status?: number;
  };
};

export class McpInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInputError";
  }
}

function jsonText(value: unknown): { type: "text"; text: string } {
  return { type: "text", text: JSON.stringify(value) };
}

function success<T>(value: T) {
  return { structuredContent: value, content: [jsonText(value)] };
}

function errorResult(error: ToolError) {
  return { structuredContent: error, content: [jsonText(error)], isError: true };
}

function toToolError(cause: unknown, fallback = "MCP tool execution failed"): ToolError {
  if (cause instanceof McpInputError) {
    return { error: { code: "invalid_input", message: cause.message, retryable: false } };
  }
  if (cause instanceof ContextApiError) {
    return {
      error: {
        code: cause.code,
        message: cause.message,
        retryable: cause.retryable,
        ...(cause.status === undefined ? {} : { status: cause.status }),
      },
    };
  }
  if (cause instanceof Error) {
    return { error: { code: "execution", message: cause.message, retryable: false } };
  }
  return { error: { code: "execution", message: fallback, retryable: false } };
}

function invalidInput(message: string): ToolError {
  return { error: { code: "invalid_input", message, retryable: false } };
}

function workError(code: "work_not_found" | "work_ambiguous", value: string): ToolError {
  return { error: { code, message: `${code}: ${value}`, retryable: false } };
}

export function parseSince(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const duration = trimmed.match(/^(\d+)(m|h|d)$/i);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return now - amount * multiplier;
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isNaN(timestamp)) return timestamp;
  throw new McpInputError("since must be a duration such as 2h or an ISO-8601 timestamp");
}

function workResult(work: Work, state: ReturnType<typeof buildWorkState>) {
  return {
    id: work.id,
    name: work.name,
    createdAt: work.createdAt,
    active: state.activeWorkId === work.id,
    resumeNote: state.resumeNotes.get(work.id) ?? null,
  };
}

function eventContent(type: McpContextType, content: string, work?: Work): string {
  const metadata = {
    type: "mcp-context" as const,
    contextType: type,
    source: "mcp" as const,
    ...(work ? { workId: work.id, name: work.name } : {}),
  };
  return `${contextEventPrefix}\n${JSON.stringify(metadata)}\n-->\n${content}`;
}

export function recordForAppend(
  type: McpContextType,
  content: string,
  work?: Work,
  lineage?: { contextId: string; revision: number; previousRecordId?: string },
): ContextRecord {
  const body = eventContent(type, content, work);
  if (encoder.encode(body).byteLength > MAX_CAPTURE_BYTES) {
    throw new McpInputError("content is too large after MCP event metadata is added");
  }
  const id = randomUUID();
  return {
    id,
    recordedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    schemaVersion: 1,
    data: {
      kind: "capture",
      content: body,
      contextId: lineage?.contextId ?? id,
      revision: lineage?.revision ?? 1,
      ...(lineage?.previousRecordId ? { previousRecordId: lineage.previousRecordId } : {}),
      source: { client: "desktop", inputMethod: "mcp" },
    },
  };
}

async function allRecords(client: ContextApiClient) {
  return client.listAllRecords();
}

async function withToolLogging<T>(name: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await action();
    console.error(JSON.stringify({ tool: name, durationMs: Date.now() - started, outcome: "ok" }));
    return result;
  } catch (cause) {
    const error = toToolError(cause).error;
    console.error(JSON.stringify({ tool: name, durationMs: Date.now() - started, outcome: "error", code: error.code }));
    throw cause;
  }
}

function asMcpContextType(value: string): McpContextType {
  return ["capture", "decision", "insight", "next"].includes(value) ? value as McpContextType : "capture";
}

async function recentContextResult(client: ContextApiClient, limit: number, since: string | undefined) {
  const cutoff = parseSince(since);
  const records: ContextRecord[] = [];
  let cursor: string | undefined;
  let reachedCutoff = false;
  while (records.length < limit && !reachedCutoff) {
    const page = await client.listRecords({ limit: 100, cursor });
    for (const record of page.records) {
      if (cutoff !== undefined && Date.parse(record.recordedAt) < cutoff) {
        reachedCutoff = true;
        break;
      }
      records.push(record);
      if (records.length >= limit) break;
    }
    if (records.length >= limit || reachedCutoff || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const state = buildWorkState(records);
  const normalized = records.map((record) => normalizeRecord(record, state));
  return { records: normalized, count: normalized.length };
}

async function activeContextResult(client: ContextApiClient) {
  const state = buildWorkState(await allRecords(client));
  const work = state.activeWorkId ? state.works.get(state.activeWorkId) : undefined;
  return work ? workResult(work, state) : null;
}

async function searchContextResult(client: ContextApiClient, query: string, limit: number) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) throw new McpInputError("query must not be empty");
  const sourceRecords = await allRecords(client);
  const state = buildWorkState(sourceRecords);
  const records = sourceRecords
    .map((record) => normalizeRecord(record, state))
    .filter((record) => [record.content, record.type, record.work?.name, record.source.client]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)))
    .slice(0, limit);
  return { records, count: records.length, query };
}

async function workContextResult(client: ContextApiClient, workInput: string, limit: number) {
  const sourceRecords = await allRecords(client);
  const state = buildWorkState(sourceRecords);
  const matches = workNameMatches(state, workInput);
  if (matches.length === 0) return errorResult(workError("work_not_found", workInput));
  if (matches.length > 1) return errorResult(workError("work_ambiguous", workInput));
  const work = matches[0];
  const records = sourceRecords
    .filter((record) => normalizeRecord(record, state).work?.id === work.id)
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || right.id.localeCompare(left.id))
    .slice(0, limit)
    .map((record) => normalizeRecord(record, state));
  return success({ work: workResult(work, state), records, count: records.length });
}

async function createContextResult(client: ContextApiClient, type: McpContextType, content: string, workInput?: string) {
  if (type !== "capture" && !workInput) return errorResult(invalidInput(`${type} records require work`));
  let work: Work | undefined;
  if (workInput) {
    const state = buildWorkState(await allRecords(client));
    const matches = workNameMatches(state, workInput);
    if (matches.length === 0) return errorResult(workError("work_not_found", workInput));
    if (matches.length > 1) return errorResult(workError("work_ambiguous", workInput));
    work = matches[0];
  }
  const response = await client.createRecord(recordForAppend(type, content, work));
  const state = buildWorkState([response.record]);
  if (work) state.works.set(work.id, work);
  return success({ record: normalizeRecord(response.record, state), idempotent: response.idempotent });
}

async function updateContextResult(client: ContextApiClient, id: string, content: string, type?: McpContextType) {
  const source = await client.getRecord(id);
  const sourceRecords = await allRecords(client);
  const state = buildWorkState(sourceRecords);
  const normalizedSource = normalizeRecord(source, state);
  const contextId = source.data.contextId ?? source.id;
  const revision = (source.data.revision ?? 1) + 1;
  const response = await client.createRecord(recordForAppend(
    type ?? asMcpContextType(normalizedSource.type),
    content,
    normalizedSource.work,
    { contextId, revision, previousRecordId: source.id },
  ));
  const nextState = buildWorkState([...sourceRecords, response.record]);
  return success({ record: normalizeRecord(response.record, nextState), idempotent: response.idempotent });
}

export function registerContextTools(server: McpServer, client: ContextApiClient, config: McpConfig): void {
  server.registerTool(
    "search_context",
    {
      description: "Search normalized Context OS records by content, type, Work name, or source client.",
      inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() }),
      annotations: readOnlyAnnotations,
    },
    async ({ query, limit = 20 }) => {
      try {
        return await withToolLogging("search_context", async () => success(await searchContextResult(client, query, limit)));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  server.registerTool(
    "get_context",
    {
      description: "Return one normalized Context OS record by record ID.",
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      try {
        return await withToolLogging("get_context", async () => {
          const record = await client.getRecord(id);
          const state = buildWorkState(await allRecords(client));
          return success({ record: normalizeRecord(record, state) });
        });
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  server.registerTool(
    "get_recent_contexts",
    {
      description: "Return recent normalized Context OS records, optionally limited to a duration or timestamp.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional(), since: z.string().min(1).optional() }),
      annotations: readOnlyAnnotations,
    },
    async ({ limit = 20, since }) => {
      try {
        return await withToolLogging("get_recent_contexts", async () => success(await recentContextResult(client, limit, since)));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  server.registerTool(
    "get_active_context",
    {
      description: "Return the current active Context OS Work and its latest resume note.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        return await withToolLogging("get_active_context", async () => success({ activeContext: await activeContextResult(client) }));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  server.registerTool(
    "get_active_work",
    {
      description: "Deprecated alias for get_active_context.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        return await withToolLogging("get_active_work", async () => success({ activeWork: await activeContextResult(client) }));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  server.registerTool(
    "get_recent_context",
    {
      description: "Deprecated alias for get_recent_contexts.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional(), since: z.string().min(1).optional() }),
      annotations: readOnlyAnnotations,
    },
    async ({ limit = 20, since }) => {
      try {
        return await withToolLogging("get_recent_context", async () => success(await recentContextResult(client, limit, since)));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  server.registerTool(
    "get_work_context",
    {
      description: "Deprecated alias for work-filtered Context lookup.",
      inputSchema: z.object({ work: z.string().min(1), limit: z.number().int().min(1).max(100).optional() }),
      annotations: readOnlyAnnotations,
    },
    async ({ work, limit = 30 }) => {
      try {
        return await withToolLogging("get_work_context", () => workContextResult(client, work, limit));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  if (config.mode !== "read-write") return;

  server.registerTool(
    "create_context",
    {
      description: "Create a Context OS capture, decision, insight, or next record without modifying existing records.",
      inputSchema: z.object({ type: z.enum(["capture", "decision", "insight", "next"]), content: z.string().min(1), work: z.string().min(1).optional() }),
    },
    async ({ type, content, work }) => {
      try {
        return await withToolLogging("create_context", () => createContextResult(client, type, content, work));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  server.registerTool(
    "update_context",
    {
      description: "Append a new Context OS revision while keeping the source record immutable.",
      inputSchema: z.object({ id: z.string().min(1), content: z.string().min(1), type: z.enum(["capture", "decision", "insight", "next"]).optional() }),
    },
    async ({ id, content, type }) => {
      try {
        return await withToolLogging("update_context", () => updateContextResult(client, id, content, type));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );

  server.registerTool(
    "append_context",
    {
      description: "Deprecated alias for create_context.",
      inputSchema: z.object({ type: z.enum(["capture", "decision", "insight", "next"]), content: z.string().min(1), work: z.string().min(1).optional() }),
    },
    async ({ type, content, work }) => {
      try {
        return await withToolLogging("append_context", () => createContextResult(client, type, content, work));
      } catch (cause) {
        return errorResult(toToolError(cause));
      }
    },
  );
}
