import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRemoteRecordsConnection,
  fetchRemoteRecordsPage,
  RemoteRecordsError,
  type FetchRemoteRecordsOptions,
} from "../src/remote-records-api.ts";

const token = "read-token-for-test";

function record(id = "record-1") {
  return {
    id,
    recordedAt: "2026-08-06T01:02:03.000Z",
    receivedAt: "2026-08-06T01:02:04.000Z",
    schemaVersion: 1,
    data: {
      kind: "capture",
      content: "A capture with **markdown-looking** text.",
      source: { client: "raycast" },
      context: {},
    },
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses[index++];
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  };
  return { calls, fetchImpl };
}

function options(fetchImpl: typeof fetch): FetchRemoteRecordsOptions {
  return { serverUrl: "https://context.example.test/", apiToken: token, fetchImpl };
}

test("fetches a normal records response with read-only auth headers", async () => {
  const { calls, fetchImpl } = mockFetch([response({ records: [record()], nextCursor: null })]);

  const page = await fetchRemoteRecordsPage(options(fetchImpl));

  assert.equal(page.records[0]?.id, "record-1");
  assert.equal(calls[0]?.url, "https://context.example.test/v1/records?limit=50");
  assert.equal(calls[0]?.init.method, "GET");
  assert.equal(new Headers(calls[0]?.init.headers).get("accept"), "application/json");
  assert.equal(new Headers(calls[0]?.init.headers).get("authorization"), `Bearer ${token}`);
});

test("checks authenticated connectivity without requiring a records response body", async () => {
  const { calls, fetchImpl } = mockFetch([new Response("not JSON", { status: 200 })]);

  await checkRemoteRecordsConnection({ ...options(fetchImpl), timeoutMs: 10_000 });

  assert.equal(calls[0]?.url, "https://context.example.test/v1/records?limit=1");
  assert.equal(new Headers(calls[0]?.init.headers).get("authorization"), `Bearer ${token}`);
});

test("returns an empty records page", async () => {
  const { fetchImpl } = mockFetch([response({ records: [], nextCursor: null })]);

  const page = await fetchRemoteRecordsPage(options(fetchImpl));

  assert.deepEqual(page.records, []);
  assert.equal(page.nextCursor, null);
});

test("passes nextCursor when fetching the next page", async () => {
  const { calls, fetchImpl } = mockFetch([
    response({ records: [record("record-1")], nextCursor: "cursor-2" }),
    response({ records: [record("record-2")], nextCursor: null }),
  ]);

  const firstPage = await fetchRemoteRecordsPage(options(fetchImpl));
  const secondPage = await fetchRemoteRecordsPage({ ...options(fetchImpl), cursor: firstPage.nextCursor ?? undefined });

  assert.equal(secondPage.records[0]?.id, "record-2");
  assert.equal(calls[1]?.url, "https://context.example.test/v1/records?limit=50&cursor=cursor-2");
});

for (const [status, code, expected] of [
  [401, "unauthorized", "API token"],
  [403, "forbidden", "read scope"],
  [429, "rate-limited", "Wait a moment"],
] as const) {
  test(`maps HTTP ${status} without exposing the token`, async () => {
    const { fetchImpl } = mockFetch([response({ secret: token, records: [] }, status)]);

    await assert.rejects(fetchRemoteRecordsPage(options(fetchImpl)), (error: unknown) => {
      assert.ok(error instanceof RemoteRecordsError);
      assert.equal(error.code, code);
      assert.match(error.message, new RegExp(expected, "i"));
      assert.doesNotMatch(error.message, new RegExp(token));
      return true;
    });
  });
}

test("rejects a malformed records response", async () => {
  const { fetchImpl } = mockFetch([response({ records: [{ id: "missing-data" }], nextCursor: null })]);

  await assert.rejects(
    fetchRemoteRecordsPage(options(fetchImpl)),
    (error: unknown) => error instanceof RemoteRecordsError && error.code === "malformed",
  );
});

test("converts an aborted request caused by timeout into a safe timeout error", async () => {
  const fetchImpl: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
        once: true,
      });
    });

  await assert.rejects(
    fetchRemoteRecordsPage({ ...options(fetchImpl), timeoutMs: 5 }),
    (error: unknown) => error instanceof RemoteRecordsError && error.code === "timeout",
  );
});
