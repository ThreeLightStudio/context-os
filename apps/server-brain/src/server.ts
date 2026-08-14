import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BrainConfig } from "./config.js";
import type { BrainApp } from "./app.js";
import { MAX_REQUEST_BYTES } from "./schemas/validation.js";

function headersFromIncoming(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) throw new Error("request body exceeds 128KB");
    chunks.push(buffer);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function toRequest(request: IncomingMessage): Promise<Request> {
  const body = await readBody(request);
  const host = request.headers.host ?? "127.0.0.1";
  const url = `http://${host}${request.url ?? "/"}`;
  return new Request(url, {
    method: request.method ?? "GET",
    headers: headersFromIncoming(request),
    ...(body ? { body: body.toString("utf8") } : {}),
  });
}

async function writeResponse(response: Response, serverResponse: ServerResponse): Promise<void> {
  serverResponse.statusCode = response.status;
  response.headers.forEach((value, key) => serverResponse.setHeader(key, value));
  const body = await response.arrayBuffer();
  serverResponse.end(Buffer.from(body));
}

export function createNodeServer(app: BrainApp) {
  return createServer(async (request, response) => {
    try {
      await writeResponse(await app.fetch(await toRequest(request)), response);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "internal server error";
      response.statusCode = message.includes("128KB") ? 413 : 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: message }));
    }
  });
}

export async function startNodeServer(app: BrainApp, config: BrainConfig): Promise<ReturnType<typeof createServer>> {
  const server = createNodeServer(app);
  await new Promise<void>((resolve, reject) => {
    const onError = (cause: Error) => {
      server.off("listening", onListening);
      reject(cause);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });
  return server;
}
