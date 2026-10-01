import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/actions/action-registry.js";
import { dailySummaryAction } from "../src/actions/daily-summary.js";
import { getLocalDateRange } from "../src/context/date-range.js";
import {
  MAX_DAILY_SUMMARY_RECORDS,
  type DailySummaryContext,
} from "../src/context/daily-summary-context.js";
import { ServerContextClientError, type ContextRecord, type ContextSource } from "../src/context/server-context-client.js";
import { parseDailySummaryInput } from "../src/schemas/validation.js";
import { TaskRunner } from "../src/tasks/task-runner.js";
import type { GenerateRequest, ModelProvider } from "../src/providers/model-provider.js";

function record(recordedAt: string, content: string, id = recordedAt): ContextRecord {
  return {
    id,
    recordedAt,
    receivedAt: recordedAt,
    schemaVersion: 1,
    data: {
      kind: "capture",
      content,
      source: { client: "desktop" },
      context: { desktop: { activeApplication: "Editor" } },
    },
  };
}

function provider(output: unknown) {
  const generateStructured = vi.fn(async (_request: GenerateRequest) => output);
  const value: ModelProvider = {
    id: "mock",
    generate: vi.fn(async () => JSON.stringify(output)),
    generateStructured,
    health: () => ({ status: "ok", provider: "mock", model: "test-model" }),
  };
  return { value, generateStructured };
}

function runner(providerValue: ModelProvider, contextSource?: ContextSource): TaskRunner {
  return new TaskRunner({
    registry: new ActionRegistry().register(dailySummaryAction),
    dependencies: { provider: providerValue, contextSource },
  });
}

describe("daily-summary date handling", () => {
  it("validates calendar dates and IANA timezones", () => {
    expect(parseDailySummaryInput({ date: "2026-08-13", timezone: "Asia/Seoul" })).toEqual({
      date: "2026-08-13",
      timezone: "Asia/Seoul",
    });
    expect(() => parseDailySummaryInput({ date: "2026-02-30", timezone: "Asia/Seoul" })).toThrow("valid YYYY-MM-DD");
    expect(() => parseDailySummaryInput({ date: "2026-08-13", timezone: "Mars/Olympus" })).toThrow("valid IANA timezone");
    expect(() => parseDailySummaryInput({ date: "2026-08-13", timezone: "Asia/Seoul", extra: true })).toThrow("input.extra");
  });

  it("converts local calendar boundaries across UTC and DST", () => {
    const seoul = getLocalDateRange("2026-08-13", "Asia/Seoul");
    expect(seoul.start.toISOString()).toBe("2026-08-12T15:00:00.000Z");
    expect(seoul.end.toISOString()).toBe("2026-08-13T15:00:00.000Z");

    const losAngeles = getLocalDateRange("2026-03-08", "America/Los_Angeles");
    expect(losAngeles.start.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(losAngeles.end.toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });
});

describe("daily-summary context resolution", () => {
  it("pages server-context records and filters by the requested local date", async () => {
    const listRecords = vi.fn(async (options: { limit?: number; cursor?: string } = {}) => {
      if (!options.cursor) {
        return {
          records: [
            record("2026-08-13T14:00:00.000Z", "evening note"),
            record("2026-08-12T15:00:00.000Z", "morning note"),
          ],
          nextCursor: "next-page",
        };
      }
      return {
        records: [record("2026-08-12T14:59:59.999Z", "outside note")],
        nextCursor: null,
      };
    });
    const contextSource: ContextSource = { listRecords };
    const mock = provider({ summary: "Two notes", keyPoints: ["morning", "evening"] });

    const execution = await runner(mock.value, contextSource).run("daily-summary", {
      date: "2026-08-13",
      timezone: "Asia/Seoul",
    });

    expect(execution.result).toEqual({
      date: "2026-08-13",
      timezone: "Asia/Seoul",
      recordCount: 2,
      summary: "Two notes",
      keyPoints: ["morning", "evening"],
      variants: {
        quick: "Two notes",
        standard: "Two notes",
        deep: "Two notes\n\n- morning\n- evening",
      },
      claims: [],
      sources: [
        {
          recordId: "2026-08-13T14:00:00.000Z",
          preview: "evening note",
          recordedAt: "2026-08-13T14:00:00.000Z",
          client: "desktop",
        },
        {
          recordId: "2026-08-12T15:00:00.000Z",
          preview: "morning note",
          recordedAt: "2026-08-12T15:00:00.000Z",
          client: "desktop",
        },
      ],
    });
    expect(listRecords).toHaveBeenNthCalledWith(1, { limit: MAX_DAILY_SUMMARY_RECORDS });
    expect(listRecords).toHaveBeenNthCalledWith(2, { limit: MAX_DAILY_SUMMARY_RECORDS, cursor: "next-page" });
    expect(mock.generateStructured).toHaveBeenCalledOnce();
    expect(mock.generateStructured.mock.calls[0][0].userPrompt).toContain("evening note");
  });

  it("returns shared answer variants and removes unsupported source IDs", async () => {
    const mock = provider({
      summary: "Supported summary",
      keyPoints: ["One point"],
      variants: { quick: "Quick", standard: "Standard", deep: "Deep" },
      claims: [
        { id: "claim-1", text: "Supported claim", sourceIds: ["source-a", "forged-id"], support: "direct" },
        { id: "claim-2", text: "Unknown claim", sourceIds: ["forged-id"], support: "direct" },
      ],
    });
    const execution = await runner(mock.value, {
      listRecords: vi.fn(async () => ({
        records: [record("2026-08-13T10:00:00.000Z", "source text", "source-a")],
        nextCursor: null,
      })),
    }).run("daily-summary", { date: "2026-08-13", timezone: "Asia/Seoul" });

    expect(execution.result).toMatchObject({
      variants: { quick: "Quick", standard: "Standard", deep: "Deep" },
      claims: [
        { id: "claim-1", sourceIds: ["source-a"], support: "direct" },
        { id: "claim-2", sourceIds: [], support: "unverified" },
      ],
      sources: [{ recordId: "source-a", preview: "source text" }],
    });
  });

  it("does not call the provider when no records match", async () => {
    const listRecords = vi.fn(async () => ({
      records: [record("2026-08-12T14:59:59.999Z", "outside note")],
      nextCursor: null,
    }));
    const mock = provider({ summary: "should not run", keyPoints: [] });

    await expect(runner(mock.value, { listRecords }).run("daily-summary", {
      date: "2026-08-13",
      timezone: "Asia/Seoul",
    })).resolves.toMatchObject({
      result: {
        date: "2026-08-13",
        timezone: "Asia/Seoul",
        recordCount: 0,
        summary: "No context records found for the selected date.",
        keyPoints: [],
      },
    });
    expect(mock.generateStructured).not.toHaveBeenCalled();
  });

  it("uses client-provided context before contacting server-context", async () => {
    const listRecords = vi.fn(async () => {
      throw new Error("server-context should not be called");
    });
    const mock = provider({ summary: "Client context", keyPoints: ["Provided"] });
    const context: DailySummaryContext = {
      date: "2026-08-13",
      timezone: "Asia/Seoul",
      records: [record("2026-08-13T00:00:00.000Z", "client record")],
    };

    const execution = await runner(mock.value, { listRecords }).run("daily-summary", {
      date: "2026-08-13",
      timezone: "Asia/Seoul",
    }, context);

    expect(execution.result).toMatchObject({ recordCount: 1, summary: "Client context" });
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("preserves a failed task when context resolution fails", async () => {
    const mock = provider({ summary: "unused", keyPoints: [] });
    const contextSource: ContextSource = {
      listRecords: vi.fn(async () => {
        throw new ServerContextClientError("server-context unavailable", "context_unreachable");
      }),
    };

    await expect(runner(mock.value, contextSource).run("daily-summary", {
      date: "2026-08-13",
      timezone: "Asia/Seoul",
    })).rejects.toMatchObject({
      code: "context",
      task: { status: "failed", error: { code: "context" } },
    });
  });
});
