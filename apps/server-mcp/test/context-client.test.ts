import { describe, expect, it, vi } from "vitest";
import { ContextApiClient, ContextApiError } from "../src/context-client.js";
import type { ContextRecord } from "../src/types.js";

const record: ContextRecord = {
  id: "01983f0d-7b32-7b4d-8d5b-8ff24c3b1001",
  recordedAt: "2026-08-18T00:00:00.000Z",
  receivedAt: "2026-08-18T00:00:01.000Z",
  schemaVersion: 1,
  data: { kind: "capture", content: "Context", source: { client: "desktop" } },
};

describe("ContextApiClient", () => {
  it("uses the existing URL and Bearer token contract for reads", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe("http://context.test/v1/records?limit=10&cursor=next");
      expect(init?.headers).toEqual({ Accept: "application/json", Authorization: "Bearer ctx_test" });
      return new Response(JSON.stringify({ records: [record], nextCursor: null }));
    });
    const client = new ContextApiClient({ serverUrl: "http://context.test/", apiToken: "ctx_test", fetchImpl });
    await expect(client.listRecords({ limit: 10, cursor: "next" })).resolves.toMatchObject({ records: [record] });
  });

  it("omits server-owned receivedAt from writes", async () => {
    const fetchImpl = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.receivedAt).toBeUndefined();
      return new Response(JSON.stringify({ record, idempotent: false }), { status: 201 });
    });
    const client = new ContextApiClient({ serverUrl: "http://context.test", apiToken: "ctx_test", fetchImpl });
    await expect(client.createRecord(record)).resolves.toMatchObject({ idempotent: false });
  });

  it.each([
    [401, "context_authentication", false],
    [403, "context_forbidden", false],
    [429, "context_rate_limited", true],
  ] as const)("maps HTTP %s to %s", async (status, code, retryable) => {
    const client = new ContextApiClient({
      serverUrl: "http://context.test",
      apiToken: "ctx_test",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: "failed" }), { status })),
    });
    await expect(client.listRecords()).rejects.toMatchObject({ code, retryable, status });
  });

  it("distinguishes timeout from an unavailable server", async () => {
    const timeoutClient = new ContextApiClient({
      serverUrl: "http://context.test",
      apiToken: "ctx_test",
      timeoutMs: 1,
      fetchImpl: vi.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })),
    });
    await expect(timeoutClient.listRecords()).rejects.toMatchObject({ code: "context_timeout", retryable: true });

    const unavailableClient = new ContextApiClient({
      serverUrl: "http://context.test",
      apiToken: "ctx_test",
      fetchImpl: vi.fn(async () => { throw new Error("offline"); }),
    });
    await expect(unavailableClient.listRecords()).rejects.toMatchObject({ code: "context_unreachable", retryable: true });
  });

  it("rejects malformed responses", async () => {
    const client = new ContextApiClient({
      serverUrl: "http://context.test",
      apiToken: "ctx_test",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ records: [], nextCursor: 4 }))),
    });
    await expect(client.listRecords()).rejects.toBeInstanceOf(ContextApiError);
    await expect(client.listRecords()).rejects.toMatchObject({ code: "context_malformed" });
  });
});
