import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/actions/action-registry.js";
import { createDefaultActionRegistry } from "../src/actions/index.js";
import type { ModelProvider } from "../src/providers/model-provider.js";
import { BrainValidationError } from "../src/schemas/validation.js";
import { InMemoryTaskStore, TaskRunError, TaskRunner } from "../src/tasks/task-runner.js";

function mockProvider(output: unknown): ModelProvider {
  return {
    id: "mock",
    generate: vi.fn(async () => JSON.stringify(output)),
    generateStructured: vi.fn(async () => output),
    health: () => ({ status: "ok", provider: "mock", model: "test" }),
  };
}

describe("TaskRunner", () => {
  it("runs summarize through the shared task lifecycle", async () => {
    const runner = new TaskRunner({
      registry: createDefaultActionRegistry(),
      dependencies: { provider: mockProvider({ summary: "Short", keyPoints: ["Point"] }) },
    });

    const execution = await runner.run("summarize", { content: "Long content" });

    expect(execution.result).toEqual({ summary: "Short", keyPoints: ["Point"] });
    expect(execution.task.status).toBe("completed");
    expect(execution.task.startedAt).toBeDefined();
    expect(execution.task.completedAt).toBeDefined();
    expect(runner.store.get(execution.task.id)).toEqual(execution.task);
  });

  it("marks malformed action input as failed", async () => {
    const runner = new TaskRunner({
      registry: createDefaultActionRegistry(),
      dependencies: { provider: mockProvider({ summary: "unused", keyPoints: [] }) },
    });

    await expect(runner.run("summarize", { content: "" })).rejects.toMatchObject({
      name: "TaskRunError",
      code: "validation",
      task: { status: "failed", error: { code: "validation" } },
    });
  });

  it("validates structured output before completing a task", async () => {
    const runner = new TaskRunner({
      registry: createDefaultActionRegistry(),
      dependencies: { provider: mockProvider({ summary: "Missing keyPoints" }) },
    });

    await expect(runner.run("summarize", { content: "Content" })).rejects.toMatchObject({
      name: "TaskRunError",
      code: "validation",
      task: { status: "failed" },
    });
  });

  it("resolves server context only when the client did not provide it", async () => {
    const resolveContext = vi.fn(async (_input: { value: string }, dependencies: { contextSource?: { listRecords: () => Promise<unknown> } }) => {
      await dependencies.contextSource?.listRecords();
      return "server-context";
    });
    const execute = vi.fn(async ({ context }: { context: string | undefined }) => ({ value: context }));
    const registry = new ActionRegistry().register({
      metadata: { name: "context-test", description: "test", inputSchema: {}, outputSchema: {} },
      parseInput: (value: unknown) => {
        if (typeof value !== "object" || value === null || !("value" in value)) throw new BrainValidationError("invalid input");
        return value as { value: string };
      },
      parseOutput: (value: unknown) => value as { value: string | undefined },
      resolveContext,
      execute,
    });
    const listRecords = vi.fn(async () => ({ records: [], nextCursor: null }));
    const runner = new TaskRunner({ registry, dependencies: { provider: mockProvider({}), contextSource: { listRecords } } });

    await runner.run("context-test", { value: "input" });
    expect(resolveContext).toHaveBeenCalledOnce();
    expect(listRecords).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ context: "server-context" }));

    await runner.run("context-test", { value: "input" }, "client-context");
    expect(resolveContext).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ context: "client-context" }));
  });

  it("enforces task state transitions", () => {
    const store = new InMemoryTaskStore();
    const task = store.create("test", {});
    expect(store.markRunning(task.id).status).toBe("running");
    expect(store.complete(task.id, { ok: true }).status).toBe("completed");
    expect(() => store.fail(task.id, "error", "too late")).toThrow("cannot fail from completed");
    expect(() => store.get("missing")).toThrow("task not found");
  });
});
