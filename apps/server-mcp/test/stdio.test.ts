import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workEvent = "<!-- context-os:event:v1\n{" +
  '"type":"work-created","workId":"work-1","name":"Context OS"' +
  "}\n-->\nWork 추가\n---\nContext OS\n---";

const records = [
  {
    id: "01983f0d-7b32-7b4d-8d5b-8ff24c3b1001",
    recordedAt: "2026-08-18T00:00:00.000Z",
    receivedAt: "2026-08-18T00:00:01.000Z",
    schemaVersion: 1,
    data: { kind: "capture", content: workEvent, source: { client: "raycast", inputMethod: "context-event" } },
  },
];

let httpServer: ReturnType<typeof createServer> | undefined;
let client: Client | undefined;

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function startContextApi() {
  httpServer = createServer(async (request, response) => {
    expect(request.headers.authorization).toBe("Bearer ctx_test");
    const recordId = request.url?.match(/^\/v1\/records\/([^?]+)$/)?.[1];
    if (request.method === "GET" && recordId) {
      const record = records.find((candidate) => candidate.id === decodeURIComponent(recordId));
      json(response, record ? 200 : 404, record ? { record } : { error: "not found" });
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/v1/records")) {
      json(response, 200, { records, nextCursor: null });
      return;
    }
    if (request.method === "POST" && request.url?.startsWith("/v1/records")) {
      const payload = JSON.parse(await readBody(request)) as { data: { content: string }; id: string; recordedAt: string };
      expect(payload.data.content).toContain('"type":"mcp-context"');
      const created = { ...payload, receivedAt: "2026-08-18T00:01:00.000Z", schemaVersion: 1 };
      records.push(created as typeof records[number]);
      json(response, 201, { record: created, idempotent: false });
      return;
    }
    json(response, 404, { error: "not found" });
  });
  await new Promise<void>((resolvePromise) => httpServer!.listen(0, "127.0.0.1", resolvePromise));
  return (httpServer.address() as AddressInfo).port;
}

afterEach(async () => {
  await client?.close().catch(() => undefined);
  client = undefined;
  await new Promise<void>((resolvePromise) => httpServer?.close(() => resolvePromise()));
  httpServer = undefined;
  records.splice(1);
});

describe("stdio MCP integration", () => {
  it("lists read tools and reads context through server-context", async () => {
    const port = await startContextApi();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(projectRoot, "dist/index.js")],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        CONTEXT_SERVER_URL: `http://127.0.0.1:${port}`,
        CONTEXT_SERVER_TOKEN: "ctx_test",
        CONTEXT_MCP_MODE: "read",
      },
      stderr: "pipe",
    });
    client = new Client({ name: "context-os-mcp-test", version: "0.1.0" });
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "search_context",
      "get_context",
      "get_recent_contexts",
      "get_active_context",
      "get_active_work",
      "get_recent_context",
      "get_work_context",
    ]);
    const result = await client.callTool({ name: "get_active_context", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ activeContext: { name: "Context OS" } });
  });

  it("registers canonical write tools only in read-write mode and appends revisions", async () => {
    const port = await startContextApi();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(projectRoot, "dist/index.js")],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        CONTEXT_SERVER_URL: `http://127.0.0.1:${port}`,
        CONTEXT_SERVER_TOKEN: "ctx_test",
        CONTEXT_MCP_MODE: "read-write",
      },
      stderr: "pipe",
    });
    client = new Client({ name: "context-os-mcp-test", version: "0.1.0" });
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "search_context",
      "get_context",
      "get_recent_contexts",
      "get_active_context",
      "get_active_work",
      "get_recent_context",
      "get_work_context",
      "create_context",
      "update_context",
      "append_context",
    ]);
    const created = await client.callTool({ name: "create_context", arguments: { type: "decision", work: "Context OS", content: "Use stdio" } });
    expect(created.isError).not.toBe(true);
    expect(created.structuredContent).toMatchObject({ record: { type: "decision", content: "Use stdio", revision: 1 } });
    const createdRecord = (created.structuredContent as { record: { id: string; contextId: string } }).record;

    const updated = await client.callTool({ name: "update_context", arguments: { id: createdRecord.id, content: "Use stdio and HTTP" } });
    expect(updated.isError).not.toBe(true);
    expect(updated.structuredContent).toMatchObject({
      record: { contextId: createdRecord.contextId, revision: 2, previousRecordId: createdRecord.id, content: "Use stdio and HTTP" },
    });
  });
});
