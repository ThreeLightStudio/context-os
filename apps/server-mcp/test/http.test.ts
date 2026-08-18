import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { createStreamableHttpNodeServer } from "../src/http.js";
import type { McpConfig } from "../src/config.js";

const workEvent = `<!-- context-os:event:v1
{"type":"work-created","workId":"work-1","name":"Context OS"}
-->
Work 추가`;

const records = [
  {
    id: "01983f0d-7b32-7b4d-8d5b-8ff24c3b1001",
    recordedAt: "2026-08-18T00:00:00.000Z",
    receivedAt: "2026-08-18T00:00:01.000Z",
    schemaVersion: 1,
    data: { kind: "capture", content: workEvent, source: { client: "raycast", inputMethod: "context-event" } },
  },
];

let contextServer: ReturnType<typeof createServer> | undefined;
let mcpServer: ReturnType<typeof createStreamableHttpNodeServer>["server"] | undefined;
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

async function listen(server: ReturnType<typeof createServer> | ReturnType<typeof createStreamableHttpNodeServer>["server"]): Promise<number> {
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  return (server.address() as AddressInfo).port;
}

async function close(server: ReturnType<typeof createServer> | ReturnType<typeof createStreamableHttpNodeServer>["server"] | undefined) {
  if (!server) return;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

afterEach(async () => {
  await client?.close().catch(() => undefined);
  client = undefined;
  await close(mcpServer);
  mcpServer = undefined;
  await close(contextServer);
  contextServer = undefined;
  records.splice(1);
});

describe("Streamable HTTP MCP integration", () => {
  it("authenticates the endpoint and serves MCP tools over /mcp", async () => {
    contextServer = createServer(async (request, response) => {
      expect(request.headers.authorization).toBe("Bearer ctx_test");
      if (request.method === "GET" && request.url?.startsWith("/v1/records")) {
        json(response, 200, { records, nextCursor: null });
        return;
      }
      if (request.method === "POST" && request.url?.startsWith("/v1/records")) {
        const payload = JSON.parse(await readBody(request));
        json(response, 201, { record: { ...payload, receivedAt: "2026-08-18T00:01:00.000Z", schemaVersion: 1 }, idempotent: false });
        return;
      }
      json(response, 404, { error: "not found" });
    });
    const contextPort = await listen(contextServer);

    const config: McpConfig = {
      contextServerUrl: `http://127.0.0.1:${contextPort}`,
      contextServerToken: "ctx_test",
      mode: "read",
      transport: "streamable-http",
      httpHost: "127.0.0.1",
      httpPort: 8789,
      httpPath: "/mcp",
      httpToken: "mcp_test",
      timeoutMs: 1_000,
    };
    mcpServer = createStreamableHttpNodeServer(config).server;
    const mcpPort = await listen(mcpServer);
    const endpoint = `http://127.0.0.1:${mcpPort}/mcp`;

    const unauthorized = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(unauthorized.status).toBe(401);

    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: "Bearer mcp_test" } },
    });
    client = new Client({ name: "context-os-http-test", version: "0.1.0" });
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["get_active_work", "get_recent_context", "get_work_context"]);
    const result = await client.callTool({ name: "get_active_work", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ activeWork: { name: "Context OS" } });
  });
});
