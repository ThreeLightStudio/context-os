import { describe, expect, it, vi } from "vitest";
import { ServerContextClient } from "../src/context/server-context-client.js";

const page = {
  records: [{
    id: "01983f0d-7b32-7b4d-8d5b-8ff24c3b1001",
    recordedAt: "2026-08-13T00:00:00.000Z",
    receivedAt: "2026-08-13T00:00:01.000Z",
    schemaVersion: 1,
    data: { kind: "capture", content: "Context", source: { client: "desktop" }, context: {} },
  }],
  nextCursor: null,
};

describe("ServerContextClient", () => {
  it("uses the existing server-context records API and token convention", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe("http://context.test/v1/records?limit=10&cursor=next");
      expect(init?.headers).toEqual({ Accept: "application/json", Authorization: "Bearer ctx_test" });
      return new Response(JSON.stringify(page));
    });
    const client = new ServerContextClient({ serverUrl: "http://context.test/", apiToken: "ctx_test", fetchImpl });

    await expect(client.listRecords({ limit: 10, cursor: "next" })).resolves.toEqual(page);
  });

  it("rejects malformed server-context responses", async () => {
    const client = new ServerContextClient({
      serverUrl: "http://context.test",
      apiToken: "ctx_test",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ records: [], nextCursor: 4 }))),
    });

    await expect(client.listRecords()).rejects.toMatchObject({ code: "context_malformed" });
  });
});
