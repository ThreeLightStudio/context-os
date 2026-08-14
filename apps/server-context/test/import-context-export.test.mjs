import { describe, expect, it, vi } from "vitest";
import { buildRecords, importRecords, parseContextExport } from "../scripts/import-context-export.mjs";

const exportText = `# Context Export

## 2026-07-20 20:32

첫 번째 기록

## 2026-07-20 20:40

<!-- context-os:event:v1
{"type":"work-activated"}
-->
현재 Work 변경
`;

describe("Context Export importer", () => {
  it("splits timestamp headings, retains event bodies, and uses Seoul time by default", () => {
    const captures = parseContextExport(exportText);
    expect(captures).toEqual([
      { ordinal: 0, capturedAt: "2026-07-20T11:32:00.000Z", content: "첫 번째 기록" },
      { ordinal: 1, capturedAt: "2026-07-20T11:40:00.000Z", content: "<!-- context-os:event:v1\n{\"type\":\"work-activated\"}\n-->\n현재 Work 변경" },
    ]);
  });

  it("produces deterministic, API-compatible records", () => {
    const captures = parseContextExport(exportText);
    const first = buildRecords(captures);
    const second = buildRecords(captures);
    expect(first.oversizeRecords).toEqual([]);
    expect(first.records).toEqual(second.records);
    expect(first.records[0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      data: { kind: "capture", source: { client: "raycast", inputMethod: "context-export" } },
    });
  });

  it("sends the importer token as a Bearer credential", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      expect(init.headers).toEqual({
        "content-type": "application/json",
        authorization: "Bearer ctx_importer-test",
      });
      return new Response(JSON.stringify({}), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await importRecords([{ id: "1", recordedAt: "2026-07-20T11:32:00.000Z", data: { kind: "capture", content: "one", source: { client: "raycast" } } }], "https://context.example", "ctx_importer-test");
    expect(result).toEqual({ created: 1, idempotent: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
