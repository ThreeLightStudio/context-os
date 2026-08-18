import { describe, expect, it } from "vitest";
import { McpInputError, parseSince, recordForAppend } from "../src/tools.js";

describe("MCP tool helpers", () => {
  it("parses relative and absolute since values", () => {
    const now = Date.parse("2026-08-18T12:00:00.000Z");
    expect(parseSince("2h", now)).toBe(now - 2 * 60 * 60 * 1000);
    expect(parseSince("2026-08-18T10:00:00.000Z", now)).toBe(now - 2 * 60 * 60 * 1000);
  });

  it("rejects invalid since values", () => {
    expect(() => parseSince("soon", 0)).toThrow(McpInputError);
  });

  it("creates a valid append-only capture with MCP metadata", () => {
    const record = recordForAppend("decision", "Use stdio", { id: "work-1", name: "Context OS", createdAt: "2026-08-18T00:00:00.000Z" });
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.data.source).toEqual({ client: "desktop", inputMethod: "mcp" });
    expect(record.data.content).toContain('"contextType":"decision"');
    expect(record.data.content).toContain("Use stdio");
    expect(new TextEncoder().encode(record.data.content).byteLength).toBeLessThanOrEqual(32 * 1024);
  });

  it("rejects content that exceeds the server capture limit after metadata", () => {
    expect(() => recordForAppend("capture", "x".repeat(32 * 1024))).toThrow(McpInputError);
  });
});
