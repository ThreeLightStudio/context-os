import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createContextApiClient, createMcpServer } from "./mcp-server.js";
import type { McpConfig } from "./config.js";

type McpSession = {
  server: ReturnType<typeof createMcpServer>;
  transport: WebStandardStreamableHTTPServerTransport;
};

function headersFromNode(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

async function readNodeBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function toWebRequest(request: IncomingMessage, fallbackHost: string): Promise<Request> {
  const body = await readNodeBody(request);
  const host = request.headers.host ?? fallbackHost;
  const url = new URL(request.url ?? "/", `http://${host}`);
  return new Request(url, {
    method: request.method,
    headers: headersFromNode(request.headers),
    ...(body === undefined ? {} : { body: body.toString("utf8") }),
  });
}

function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return undefined;
  const token = value.slice("Bearer ".length).trim();
  return token || undefined;
}

function tokensEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function writeWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (!response.body) {
    target.end();
    return;
  }
  Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream<any>).pipe(target);
}

export class StreamableHttpMcpApp {
  private readonly sessions = new Map<string, McpSession>();

  constructor(private readonly config: McpConfig) {}

  private async createSession(): Promise<McpSession> {
    let session!: McpSession;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, session);
      },
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId);
      },
    });
    const server = createMcpServer(this.config, createContextApiClient(this.config));
    session = { server, transport };
    await server.connect(transport);
    return session;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== this.config.httpPath) return jsonResponse(404, { error: "not_found" });

    if (!tokensEqual(bearerToken(request), this.config.httpToken)) {
      return jsonResponse(401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
    }

    const sessionId = request.headers.get("mcp-session-id");
    let session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) {
      if (request.method !== "POST" || sessionId) return jsonResponse(404, { error: "mcp_session_not_found" });
      session = await this.createSession();
    }

    return session.transport.handleRequest(request);
  }

  async close(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(async ({ server, transport }) => {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }));
  }
}

export function createStreamableHttpNodeServer(config: McpConfig): { server: Server; app: StreamableHttpMcpApp } {
  const app = new StreamableHttpMcpApp(config);
  const server = createServer(async (request, response) => {
    const started = Date.now();
    let status = 500;
    try {
      const webRequest = await toWebRequest(request, `${config.httpHost}:${config.httpPort}`);
      const webResponse = await app.handle(webRequest);
      status = webResponse.status;
      await writeWebResponse(webResponse, response);
    } catch (cause) {
      status = 500;
      if (!response.headersSent) {
        await writeWebResponse(jsonResponse(500, { error: "mcp_http_failure" }), response);
      } else {
        response.destroy(cause instanceof Error ? cause : undefined);
      }
    } finally {
      console.error(JSON.stringify({ path: request.url ?? "", method: request.method ?? "", durationMs: Date.now() - started, status }));
    }
  });
  server.once("close", () => { void app.close(); });
  return { server, app };
}

export async function listenStreamableHttpNodeServer(config: McpConfig): Promise<Server> {
  const { server } = createStreamableHttpNodeServer(config);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.httpPort, config.httpHost, () => resolve());
  });
  return server;
}
