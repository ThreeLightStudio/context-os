import { describe, expect, it, vi } from "vitest";
import { createDefaultActionRegistry } from "../src/actions/index.js";
import type { ModelProvider } from "../src/providers/model-provider.js";
import { MAX_VOICE_TRANSCRIPT_BYTES, parseVoiceContextDraftOutput } from "../src/schemas/validation.js";
import { TaskRunner } from "../src/tasks/task-runner.js";

function provider(output: unknown): ModelProvider {
  return {
    id: "mock",
    generate: vi.fn(async () => JSON.stringify(output)),
    generateStructured: vi.fn(async () => output),
    health: () => ({ status: "ok", provider: "mock", model: "test" }),
  };
}

const validDraft = {
  summary: "A faithful summary.",
  decisions: ["Keep audio local."],
  insights: [],
  next: ["Review the draft."],
  questions: [],
  suggestedWork: null,
  topic: "Voice Capture",
  contextType: "plan",
};

describe("voice-context-draft action", () => {
  it("is registered and validates a structured result", async () => {
    const registry = createDefaultActionRegistry();
    expect(registry.list().map(({ name }) => name)).toContain("voice-context-draft");
    const runner = new TaskRunner({ registry, dependencies: { provider: provider(validDraft) } });
    const execution = await runner.run("voice-context-draft", { transcript: "We should keep the audio local." });
    expect(execution.result).toEqual(validDraft);
    expect(execution.task.status).toBe("completed");
  });

  it("rejects oversized transcripts and invalid optional candidates", async () => {
    const runner = new TaskRunner({ registry: createDefaultActionRegistry(), dependencies: { provider: provider(validDraft) } });
    await expect(runner.run("voice-context-draft", { transcript: "x".repeat(MAX_VOICE_TRANSCRIPT_BYTES + 1) })).rejects.toMatchObject({ code: "validation" });
    expect(() => parseVoiceContextDraftOutput({ ...validDraft, contextType: "current-state" })).toThrow("contextType is invalid");
    expect(() => parseVoiceContextDraftOutput({ ...validDraft, suggestedWork: 12 })).toThrow("suggestedWork");
  });
});
