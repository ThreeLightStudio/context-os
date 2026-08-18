import { describe, expect, it } from "vitest";
import { buildWorkState, contextEventPrefix, workNameMatches } from "../src/events.js";
import { normalizeRecord } from "../src/normalize.js";
import type { ContextRecord } from "../src/types.js";

function record(id: string, recordedAt: string, content: string): ContextRecord {
  return {
    id,
    recordedAt,
    receivedAt: recordedAt,
    schemaVersion: 1,
    data: { kind: "capture", content, source: { client: "desktop" } },
  };
}

function event(
  type: "work-created" | "work-activated" | "resume-note-set" | "mcp-context",
  metadata: Record<string, unknown>,
  body: string,
) {
  return `${contextEventPrefix}\n${JSON.stringify({ type, ...metadata })}\n-->\n${body}`;
}

describe("Context OS event aggregation", () => {
  it("folds Work lifecycle events and resume notes chronologically", () => {
    const records = [
      record("capture", "2026-08-18T00:03:00.000Z", "raw work note"),
      record("created", "2026-08-18T00:00:00.000Z", event("work-created", { workId: "work-1", name: "Context OS" }, "Work 추가\n---\nContext OS\n---")),
      record("note", "2026-08-18T00:04:00.000Z", event("resume-note-set", { workId: "work-1", note: "Resume here" }, "resume")),
      record("created-2", "2026-08-18T00:05:00.000Z", event("work-created", { workId: "work-2", name: "ThreeLight" }, "Work 추가\n---\nThreeLight\n---")),
      record("activate", "2026-08-18T00:06:00.000Z", event("work-activated", { workId: "work-1" }, "현재 Work 변경")),
    ];

    const state = buildWorkState(records);
    expect(state.activeWorkId).toBe("work-1");
    expect(state.works.get("work-1")).toMatchObject({ id: "work-1", name: "Context OS" });
    expect(state.resumeNotes.get("work-1")).toBe("Resume here");

    const normalized = normalizeRecord(records[0], state);
    expect(normalized.work).toMatchObject({ id: "work-1", association: "timeline-derived" });
  });

  it("keeps MCP semantic records explicitly associated with their Work", () => {
    const work = record("created", "2026-08-18T00:00:00.000Z", event("work-created", { workId: "work-1", name: "Context OS" }, "Work 추가\n---\nContext OS\n---"));
    const decision = record("decision", "2026-08-18T00:01:00.000Z", event("mcp-context", { contextType: "decision", workId: "work-1", name: "Context OS", source: "mcp" }, "Use stdio"));
    const state = buildWorkState([work, decision]);

    expect(normalizeRecord(decision, state)).toMatchObject({
      type: "decision",
      content: "Use stdio",
      work: { id: "work-1", name: "Context OS", association: "explicit" },
    });
  });

  it("reports duplicate Work names for callers to handle", () => {
    const records = [
      record("one", "2026-08-18T00:00:00.000Z", event("work-created", { workId: "work-1", name: "Same" }, "Work 추가\n---\nSame\n---")),
      record("two", "2026-08-18T00:01:00.000Z", event("work-created", { workId: "work-2", name: "Same" }, "Work 추가\n---\nSame\n---")),
    ];
    const state = buildWorkState(records);
    expect(workNameMatches(state, "Same").map((work) => work.id)).toEqual(["work-1", "work-2"]);
  });
});
