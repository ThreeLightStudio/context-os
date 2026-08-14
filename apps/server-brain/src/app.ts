import { createDefaultActionRegistry } from "./actions/index.js";
import { ActionRegistry, UnknownActionError } from "./actions/action-registry.js";
import { BrainValidationError, MAX_REQUEST_BYTES, parseActionExecutionRequest } from "./schemas/validation.js";
import type { BrainConfig } from "./config.js";
import type { ContextSource } from "./context/server-context-client.js";
import { TaskNotFoundError, TaskRunError, TaskRunner } from "./tasks/task-runner.js";
import type { ModelProvider } from "./providers/model-provider.js";

export interface BrainAppOptions {
  config: BrainConfig;
  provider: ModelProvider;
  contextSource?: ContextSource;
  registry?: ActionRegistry;
  taskRunner?: TaskRunner;
}

export interface BrainApp {
  fetch(request: Request): Promise<Response>;
  registry: ActionRegistry;
  taskRunner: TaskRunner;
}

const securityHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  vary: "Origin",
};

function originAllowed(request: Request, config: BrainConfig): boolean {
  const origin = request.headers.get("origin");
  return origin === null || config.allowedOrigins.has(origin);
}

function responseHeaders(request: Request, config: BrainConfig): Headers {
  const headers = new Headers(securityHeaders);
  const origin = request.headers.get("origin");
  if (origin !== null && config.allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type, authorization");
    headers.set("access-control-max-age", "600");
  }
  return headers;
}

function json(request: Request, config: BrainConfig, body: unknown, init: ResponseInit = {}): Response {
  const headers = responseHeaders(request, config);
  headers.set("content-type", "application/json; charset=utf-8");
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { ...init, headers });
}

function error(request: Request, config: BrainConfig, status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json(request, config, { error: message, ...extra }, { status });
}

function authorize(request: Request, config: BrainConfig): Response | undefined {
  if (!config.apiToken) return undefined;
  const expected = `Bearer ${config.apiToken}`;
  if (request.headers.get("authorization") !== expected) {
    return json(request, config, { error: "authentication required" }, {
      status: 401,
      headers: { "www-authenticate": "Bearer" },
    });
  }
  return undefined;
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new BrainValidationError("content-type must be application/json");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) {
    throw new BrainValidationError("request body exceeds 128KB");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BYTES) throw new BrainValidationError("request body exceeds 128KB");
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new BrainValidationError("request body must be valid JSON");
  }
}

function providerHealth(provider: ModelProvider) {
  return provider.health();
}

export function createBrainApp(options: BrainAppOptions): BrainApp {
  const registry = options.registry ?? createDefaultActionRegistry();
  const taskRunner = options.taskRunner ?? new TaskRunner({
    registry,
    dependencies: { provider: options.provider, contextSource: options.contextSource },
  });
  const config = options.config;

  return {
    registry,
    taskRunner,
    async fetch(request: Request): Promise<Response> {
      if (!originAllowed(request, config)) return error(request, config, 403, "origin is not allowed");
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: responseHeaders(request, config) });
      }
      const unauthorized = authorize(request, config);
      if (unauthorized) return unauthorized;

      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/health") {
          return json(request, config, { status: "ok", provider: providerHealth(options.provider) });
        }

        if (request.method === "GET" && url.pathname === "/v1/actions") {
          return json(request, config, { actions: registry.list() });
        }

        if (request.method === "POST" && url.pathname === "/v1/actions") {
          const payload = parseActionExecutionRequest(await readJson(request));
          const execution = await taskRunner.run(payload.action, payload.input, payload.context);
          return json(request, config, execution);
        }

        const taskId = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/)?.[1];
        if (request.method === "GET" && taskId) {
          return json(request, config, { task: taskRunner.store.get(decodeURIComponent(taskId)) });
        }

        return error(request, config, 404, "not found");
      } catch (cause) {
        if (cause instanceof BrainValidationError) return error(request, config, 400, cause.message);
        if (cause instanceof UnknownActionError) return error(request, config, 404, cause.message);
        if (cause instanceof TaskNotFoundError) return error(request, config, 404, cause.message);
        if (cause instanceof TaskRunError) {
          const status = cause.code === "validation" ? 400 : cause.code === "provider" || cause.code === "context" ? 502 : 500;
          return error(request, config, status, cause.message, { task: cause.task });
        }
        console.error(cause);
        return error(request, config, 500, "internal server error");
      }
    },
  };
}
