import { describe, expect, it, vi } from "vitest";
import { createBrainApp } from "../src/app.js";
import type { BrainConfig } from "../src/config.js";
import { ModelProviderError, type ModelProvider } from "../src/providers/model-provider.js";

const config: BrainConfig = {
  host: "127.0.0.1",
  port: 8788,
  provider: "local",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "test-model",
  apiToken: "brain-test-token",
  allowedOrigins: new Set(["chrome-extension://test"]),
  providerTimeoutMs: 1000,
};

function provider(output: unknown): ModelProvider {
  return {
    id: "mock",
    generate: vi.fn(async () => JSON.stringify(output)),
    generateStructured: vi.fn(async () => output),
    health: () => ({ status: "ok", provider: "mock", model: "test-model" }),
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://127.0.0.1:8788${path}`, init);
}

describe("server-brain HTTP app", () => {
  it("lists actions and executes summarize end to end", async () => {
    const app = createBrainApp({ config, provider: provider({ summary: "Done", keyPoints: ["A"] }) });

    const actions = await app.fetch(request("/v1/actions", { headers: { Authorization: "Bearer brain-test-token" } }));
    expect(actions.status).toBe(200);
    const actionBody = await actions.json() as { actions: Array<{ name: string }> };
    expect(actionBody.actions.map(({ name }) => name)).toEqual(["summarize", "daily-summary", "voice-context-draft"]);

    const response = await app.fetch(request("/v1/actions", {
      method: "POST",
      headers: { Authorization: "Bearer brain-test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "summarize", input: { content: "Content" } }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { result: unknown; task: { id: string; status: string } };
    expect(body.result).toEqual({ summary: "Done", keyPoints: ["A"] });
    expect(body.task.status).toBe("completed");

    const task = await app.fetch(request(`/v1/tasks/${body.task.id}`, { headers: { Authorization: "Bearer brain-test-token" } }));
    expect(task.status).toBe(200);
    expect(await task.json()).toMatchObject({ task: { id: body.task.id, status: "completed" } });
  });

  it("executes daily-summary through the HTTP Action endpoint", async () => {
    const app = createBrainApp({
      config,
      provider: provider({ summary: "Daily result", keyPoints: ["Captured note"] }),
      contextSource: {
        listRecords: vi.fn(async () => ({
          records: [{
            id: "daily-record",
            recordedAt: "2026-08-13T00:00:00.000Z",
            receivedAt: "2026-08-13T00:00:01.000Z",
            schemaVersion: 1 as const,
            data: { kind: "capture" as const, content: "Captured note", source: { client: "desktop" } },
          }],
          nextCursor: null,
        })),
      },
    });

    const response = await app.fetch(request("/v1/actions", {
      method: "POST",
      headers: { Authorization: "Bearer brain-test-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "daily-summary",
        input: { date: "2026-08-13", timezone: "Asia/Seoul" },
      }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        date: "2026-08-13",
        timezone: "Asia/Seoul",
        recordCount: 1,
        summary: "Daily result",
        keyPoints: ["Captured note"],
      },
      task: { status: "completed" },
    });
  });

  it("returns structured authentication, CORS, and validation errors", async () => {
    const app = createBrainApp({ config, provider: provider({ summary: "Done", keyPoints: [] }) });

    const unauthenticated = await app.fetch(request("/health"));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toBe("Bearer");

    const blocked = await app.fetch(request("/health", {
      headers: { Authorization: "Bearer brain-test-token", Origin: "https://untrusted.example" },
    }));
    expect(blocked.status).toBe(403);

    const preflight = await app.fetch(request("/v1/actions", {
      method: "OPTIONS",
      headers: { Origin: "chrome-extension://test" },
    }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("chrome-extension://test");

    const invalid = await app.fetch(request("/v1/actions", {
      method: "POST",
      headers: { Authorization: "Bearer brain-test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "summarize", input: { content: "" } }),
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "input.content must be a non-empty string" });
  });

  it("maps provider failures to 502 and preserves a failed task", async () => {
    const failingProvider: ModelProvider = {
      id: "mock",
      generate: vi.fn(async () => ""),
      generateStructured: vi.fn(async () => { throw new ModelProviderError("provider down"); }),
      health: () => ({ status: "ok", provider: "mock", model: "test-model" }),
    };
    const app = createBrainApp({ config, provider: failingProvider });

    const response = await app.fetch(request("/v1/actions", {
      method: "POST",
      headers: { Authorization: "Bearer brain-test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "summarize", input: { content: "Content" } }),
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ task: { status: "failed", error: { code: "provider" } } });
  });
});
